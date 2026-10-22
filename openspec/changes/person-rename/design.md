# Design

Revision 5 (22-Oct-2026): round-3 review applied. DECISIONs are the
coordinator's and final.

## Context

Stacked on `person-identities` (#371, head `8f3d906`, merging to dev). What
#371 actually shipped and this change builds on: it **mints `usr_<20 hex>`
ids** for Google-created and signed-up people (`newPersonId()`); it adds a
**`username` column** (unique ignoring case, `user_username_lower_uq`) used by
password sign-in; a **DB trigger refuses id changes** unless the session sets
`featherbase.allow_person_id_change = 'on'`; `social_login` is dropped;
tokens without `iat` are rejected. Today the `user` table still holds humans
and service accounts (`user_type = 'service'`); `access_token.owner`
references `user` (NO ACTION) and humans mint personal tokens; `has_role.
parenttype = 'User'`; `data_scope."user"` and `share.user` are `Reference →
User`; `who(c)` writes a user id into `created_by`/`owner`/`modified_by`,
Activity Log, Version, Comment and notifications; `isBypassUser` reads roles
by user id; Reference pickers list `User` rows.

Dev: ~280 accounts (264 with the employee code as id, a few `usr_`/address
ids, Administrator, Guest, a handful of service accounts), ~40 daily StyleHR
sign-ins in a live trial. Prod: platform-only.

**DECISION (A-B2): 0101 and `person-resolution`'s 0102 (Phase 1a-i) deploy to
dev together, in one release.** Test mode needs 0102's identifier rows, and
the roster sync stays frozen until data-warehouse#4336 is rebuilt on D11.

## Goals / Non-Goals

**Goals:** `person` as the human's table; service accounts as their own
principal kind with nothing lost; `psn_` ids for every person and `svc_` ids
for every service account; the sign-in table renamed; one registry-driven
re-id of dev in one transaction with a provable scan; a rehearsed deploy.

**Non-Goals:** identifiers, merging, clusters (`person-resolution`);
`tenancy.ts` site users (unchanged); any compatibility alias (`/api/users`
is removed).

## Decisions

### R1. `user` → `person`; ids and namespaces

- Table `person`, Admin "Person", API `/api/people/…`. Every
  `column_def.reference_table = 'User'` becomes `'Person'`; `has_role.
  parenttype = 'Person'`; the CDC maps `featherbase.person` → `access`.
  Reason: a "user" uses the system, and from the next phase most rows never
  will; HR and MDM call the human Person; identity platforms say User because
  for them the record *is* the login, which Featherbase separates.
- **Final prefix `psn_`** (DECISION): `person.row_id = 'psn_' + 20 lowercase
  base32`. `newPersonId()` is renamed and re-prefixed; **existing `usr_` ids
  are converted** by the re-id like any other id. **`username` carries over**
  to `person` with its unique index.
- **Namespaces are check constraints:** `check (built_in or row_id like
  'psn\_%')` on `person`; `check (row_id like 'svc\_%')` on `service_account`.
- **Built-ins (A-B3): Administrator and Guest keep their ids**, are
  `built_in = true`, and are **excluded from the re-id and from the scan**.
- The #371 id-change trigger is **renamed** to `person_id_is_permanent` and
  kept; the migration sets `featherbase.allow_person_id_change = 'on'` for
  the re-id transaction only.

### R2. One principal model; service accounts in their own table

- Raw table `service_account (row_id 'svc_…' pk, label, enabled, created_at,
  created_by)`. Rows with `user_type = 'service'` move here and **get fresh
  `svc_` ids through the registry** (DECISION); `user_type` is dropped.
- **A principal is a person or a service account.** Every table that refers
  to "who may act" uses **`principal_kind` (`person` \| `service_account`) +
  `principal_id`** — `access_token` (replaces `owner`), `data_scope`
  (replaces `"user"`), `share` (replaces `user`), `has_role` (`parenttype` =
  `Person` \| `Service Account`, `parent` = id). A `check` constrains the
  kind; an **existence trigger** is the FK (Postgres cannot FK two tables):
  it refuses an insert or update whose principal does not exist **and
  refuses deleting a principal that still holds scope, share or token rows**
  (the old NO ACTION semantics, now for both kinds). Pinned by tests.
- **Admin forms.** Data Scope and Share are Tables, so the generic FormView
  renders them from metadata: `principal_kind` is a `Choice` column and
  `principal_id` is a **`Dynamic Reference`** whose target table is driven by
  `principal_kind` (`Person` ⇒ the Person picker, which excludes service
  accounts, replaced and built-in records; `Service Account` ⇒ the
  service-account picker). The engine already supports Dynamic Reference
  columns (Share's target uses one); no per-form code.
- **Service-account roles are written only through `service-accounts.ts`**
  (`POST /api/service-accounts/:id/roles`), never through the generic
  document path; `has_role` rows with `parenttype = 'Service Account'` are
  refused by the generic save.
- **Personal tokens stay.** `auth.ts` resolves a token to either kind,
  refuses a disabled owner of either kind; the session carries
  `principal_kind`.
- **One `getScopeMap(principal)`** replaces `getUserPermissionMap(user)` and
  is the only reader of `data_scope` — used by list, get, query/report,
  search, export, realtime, sales-target and bound sources. **Test:** a
  scoped service-account token is narrowed on every one of those paths.
  Nothing a service account holds is lost; a scope row that cannot be moved
  aborts the migration (never fail-open).
- **Inventory of person-assuming places** (each a task + test): `who(c)` and
  every `created_by`/`owner`/`modified_by` writer; Activity Log, Version,
  Comment, notification writers; `isBypassUser` → `isPrivileged(principal)`;
  `permissions.ts` `getRoles` (`parenttype = 'User'`) and
  `getUserPermissionMap`; Reference pickers; `resolveToken`; the lockout
  guard (persons only); `service-accounts.ts` (creation, listing, the "owner
  enabled" subquery, roles endpoint); **`rate-limit.ts`** (`api_rate_limit`
  rows move with service accounts and key on `principal_id`); **comment
  mentions** (by display name, never `row_id`); **`assignment-rules.ts`**
  (`assignment_rule_user`, `last_user` → person ids); **`sales-target.ts`**
  (`platformRelation('user')` → `person`; the seed's `row_id: a.username`
  becomes `username: a.username` with a minted `psn_` id); **`workflow.ts`**,
  **`jobs/sla-escalation.ts`** (recipients are persons), **`reports/
  user-report.ts`** (→ person report), **`app-access.ts`**,
  **`admin-bootstrap.ts`** (Administrator is a built-in person),
  **`password-reset.ts`** (persons only), **`cli.ts`** (`create-user` →
  `create-person`, service-account commands). Mail recipients: service
  accounts have no email.
- **Test:** a service-account token does everything it does today (reads
  with its scope, writes within its roles, refused when disabled, listed to
  the right admins, rate-limited as before).

### R3. Registry-driven re-id of dev; the scan

- The re-id uses the handler registry that `person-resolution` D6 defines
  for merges, extended with **history handlers**: `created_by`, `owner`,
  `modified_by` on every Table (from metadata), Activity Log, Version,
  Comment, notifications. Rewriting history is allowed because dev is trial
  data. Raw tables: `access_token`, `api_rate_limit`, `user_settings`,
  `password_reset`, `saved_view`, `home_page`, `sign_in_identity`,
  `data_scope`, `share`, `has_role`, `assignment_rule_user`; **registered
  JSON paths** (saved-view filters, assignment-rule conditions, home-page
  layout). Service accounts are re-id'd by the same registry (`svc_`).
- **The post-check scan (A-B1 = B-R1)** scans **only registered id columns
  and registered JSON paths, with exact-value matching** against the id map.
  **Code-carrying columns are declared "not a person reference, leave
  untouched"** and are neither rewritten nor scanned: the `employee_code` and
  `stylehr_username` Custom Fields, and `sign_in_identity.subject` (an
  employee code until `person-resolution` C4 rewrites it). **Free text is
  never scanned and left alone**: Comment bodies, notification subjects,
  Activity Log messages. The registry therefore classifies every text column
  of every Table as `id` / `json-with-ids` / `code` / `free-text`, and
  **`cli people:plan` lists every text column with its classification**; an
  unclassified column fails the plan.
- **One transaction**: set `allow_person_id_change`, mint the map (built-ins
  excluded), rewrite through the registry, run the scan; one exact hit in a
  registered column aborts and the migration prints the column. Write
  `person_id_map (old_id, new_id, kind)` (not mirrored).
- **Test:** a fixture with populated `employee_code`, `stylehr_username`,
  `subject`, Comment bodies and notification subjects that *contain* old ids
  passes the scan; a planted old id in a registered column fails it.
- **Sessions end at deploy** (the JWT `sub` changes); everyone signs in
  again once. **Tokens are rewritten** (`principal_id` → new id; the secret
  is unchanged, so scripts keep working).

### R4. `user_identity` → `sign_in_identity`

Rename; `user_id` → `person_id`; columns otherwise unchanged. The subject
rewrite to StyleHR record numbers is `person-resolution`'s (C4).

### R5. CDC and warehouse plan (same release)

- Registration: `featherbase.user` removed, `featherbase.person` added
  (`access`); `service_account`, `person_id_map` denied; `has_role`,
  `data_scope`, `share` keep flowing with `principal_kind`/`principal_id`.
- **CDC rehearsal before the release tick** (A-M2): run the worker against
  a restored dev snapshot with 0101 applied — the `user` → `person` rename
  and the dropped `data_scope."user"` — and confirm it drops `access.user`,
  snapshots `access.person`, and reconciles row counts.
- Models to repoint: a grep of `dbt_runner/dbt/models` and `scripts` for
  `access.user` on 22-Oct-2026 found no reader; data-warehouse#4336 re-checks
  at release and repoints anything reading `access.user`, `has_role.parent`
  or `data_scope.user`.

### R6. Deploy safety (A-M2) and the frozen sync (A-B2)

- **Mandatory rehearsal:** the full 0101 + 0102 migration plus the scan, in
  a **rolled-back transaction against a restored dev snapshot**. One exists
  (`rama_dw/secrets/featherbase-old-prod-backups/featherbase-dev-pre-371-20261022.sql.gz`);
  **a fresh snapshot is taken at deploy time** and the rehearsal repeated
  on it. `cli people:plan --rehearse <dsn>` runs it.
- **Maintenance window:** announced to the trial users; 30 minutes outside
  store hours (proposed 06:00–06:30 IST); everyone signs in again
  afterwards.
- **The roster sync stays frozen** until data-warehouse#4336 is rebuilt on
  `person-resolution` D11. **Until then leavers are disabled by hand** — a
  written procedure in DEPLOY.md: the HR contact mails the code, a System
  Manager finds the person by code (identifier search) and disables them,
  which ends every session and every way in (#371's rule). **No
  compatibility alias for `/api/users`.**

## Migration (`0101_person_rename.ts`, one transaction, rehearsable)

1. Rename `user` → `person` (table, indexes incl. `user_username_lower_uq` →
   `person_username_lower_uq`, trigger → `person_id_is_permanent`,
   `table_def`/`column_def`, every `Reference → User`); `user_identity` →
   `sign_in_identity` (`person_id`); add `person.built_in` and the namespace
   check (deferred until after step 4).
2. Create `service_account`; `principal_kind`/`principal_id` + check +
   existence trigger on `access_token`, `data_scope`, `share`; `has_role`
   parenttypes; move `user_type = 'service'` rows; drop `user_type`,
   `access_token.owner`, `data_scope."user"`, `share.user`.
3. Classify every text column (R3); abort on an unclassified one.
4. Re-id through the registry (persons `psn_`, service accounts `svc_`,
   built-ins excluded, `usr_` converted), scan, `person_id_map`.
5. Enable the namespace checks.

**DEPLOY.md order:** 0100 live → fresh dev snapshot → `people:plan
--rehearse` (0101 + 0102 + scan, rolled back) → CDC rehearsal → maintenance
window → deploy (0101 + 0102 run; everyone signs in again) → CDC registration
change and release tick → post-deploy counts (persons by prefix, service
accounts, tokens by kind, zero scan hits, trial sign-ins working) → manual
leaver procedure in force until #4336.

## Risks

- **The re-id touches every registered column.** Bounded by the registry
  classification, the exact-match scan, the rehearsal and the rolled-back
  dry run.
- **A missed principal assumption** surfaces as a service-account
  regression; the R2 inventory, the `getScopeMap` narrowing test and the
  "does everything it does today" test are the guards.
- **Everyone signs in again once**, inside the window.
- **Leavers between the deploy and #4336** rely on the manual procedure.

## Test plan

`person-rename.test.ts`: tables renamed; `/api/users` gone; namespace
checks; built-ins untouched; `usr_` converted; `username` carried; principal
check and existence trigger incl. delete refusal; Dynamic Reference rendering
of Data Scope / Share; service-account roles only via `service-accounts.ts`;
`isPrivileged` both kinds; pickers exclude service accounts; `who(c)` writes
principal ids; mentions by name; rate limits move. `scope-map.test.ts`: a
scoped service-account token narrowed on list, get, query/report, search,
export, realtime, sales-target and bound sources. `token-hardening.test.ts`:
personal and service tokens resolve; disabled owners refused.
`migration-0101.test.ts`: dev-shaped fixture; code and free-text columns
containing old ids pass; a planted id in a registered column fails;
classification lists every text column; idempotent; `people:plan` parity;
`--rehearse` rolls back. Web: "Person" labels; Data Scope / Share forms;
service-account list. Gates: typecheck, suites, `pnpm check:specs`,
`git diff --check`.
