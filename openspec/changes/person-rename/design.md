# Design

## Context

Stacked on `person-identities` (#371). Split out of `person-resolution` rev 3
by the coordinator's round-2 decision so the structural clean-start lands on
its own, reviewable, before identifiers and merging. Today: the `user` table
holds humans and service accounts (`user_type = 'service'`); `access_token.owner`
references `user` with a NO ACTION foreign key and humans mint personal tokens
(`index.ts` token routes; `auth.ts` reads `"user"` to resolve a token's owner);
`has_role.parenttype = 'User'`; `data_scope."user"` and `share.user` are
`Reference → User`; `who(c)` writes a user id into `created_by`/`owner`/
`modified_by`, Activity Log, Version, Comment and notifications;
`isBypassUser` reads roles by user id; Reference pickers list `User` rows.

Dev: 277 accounts (264 with the employee code as id, a few with an address,
Administrator, Guest, a handful of service accounts), ~40 daily StyleHR
sign-ins. Prod: platform-only.

## Goals / Non-Goals

**Goals:** `person` as the human's table; service accounts as their own
principal kind with nothing lost; opaque ids for every person; the sign-in
table renamed; one registry-driven re-id of dev in one transaction.

**Non-Goals:** identifiers, merging, clusters (`person-resolution`);
multi-tenant `tenancy.ts` site users (out of scope, unchanged).

## Decisions

### R1. `user` → `person`

Table `person`, Admin "Person", API `/api/people/…` (`/api/users/…` is
removed, not aliased). Every `column_def.reference_table = 'User'` becomes
`'Person'`; `data_scope.person`, `share.person`; `has_role.parenttype =
'Person'`; the CDC maps `featherbase.person` → `access`. Reason (merits only):
a "user" uses the system, and from the next phase most rows never will; HR and
MDM call the human **Person** (SuccessFactors, Workday, FHIR); identity
platforms say User because for them the record *is* the login, which
Featherbase separates. *Consistency.*

### R2. One principal model; service accounts in their own table

- Raw table `service_account (row_id 'svc_…' pk, label, enabled, created_at,
  created_by)`. Rows with `user_type = 'service'` move here; `user_type` is
  dropped.
- **A principal is a person or a service account.** Every table that refers to
  "who may act" carries `principal_kind` (`person` \| `service_account`) and
  `principal_id`, with `check (principal_kind in (…))` and a trigger-enforced
  existence check (Postgres cannot FK to two tables; the trigger is the
  arbiter, pinned by a test). Tables: `access_token` (replaces `owner`, keeps
  the NO ACTION semantics: a principal with tokens cannot be deleted),
  `data_scope`, `share`, `has_role` (already `parent` + `parenttype`; the
  parenttype values are `Person` and `Service Account`).
- **Personal tokens stay** (coordinator decision). A token's owner can be a
  person or a service account; `auth.ts` resolves either, refuses a disabled
  owner of either kind, and the session carries `principal_kind`.
- **Nothing a service account holds is lost**: its Data Scope and Share rows
  move with it; its roles keep working; `isBypassUser` becomes
  `isPrivileged(principal)` reading `has_role` for either kind. Never
  fail-open: a scope row that cannot be moved aborts the migration.
- **Inventory of places that assume the principal is a person** (each gets a
  task and a test): `who(c)` → `created_by`/`owner`/`modified_by` (now a
  principal id; ids are namespaced `psn_`/`svc_` so a plain text column still
  resolves); Activity Log, Version, Comment and notification writers;
  `isBypassUser`; `permissions.ts` `getRoles` (`parenttype = 'User'`); Reference
  pickers (a `Reference → Person` column lists persons only; a service account
  is never pickable as a person); `resolveToken`; the lockout guard (counts
  persons only); `service-accounts.ts` (creation, listing, the "owner enabled"
  subquery); mention suggestions; mail recipients (service accounts have no
  email).
- **Test:** a service-account token does everything it does today — reads
  with its scope, writes within its roles, is refused when disabled, is listed
  to the right admins.

### R3. Opaque ids for every person; registry-driven re-id of dev

- `person.row_id = 'psn_' + 20 random base32 characters`, minted by
  Featherbase; a controller refuses renaming a Person row.
- **The re-id uses the handler registry** that `person-resolution` D6 defines
  for merges, extended with history handlers: `created_by`, `owner`,
  `modified_by` on every Table (walked from metadata), Activity Log, Version,
  Comment, notifications. Rewriting history is allowed because dev is trial
  data. Registered raw tables: `access_token` (`principal_id`),
  `user_settings`, `password_reset`, `saved_view`, `home_page`, `sign_in_identity`,
  `data_scope`, `share`, `has_role`, plus JSON ids (saved-view filters,
  assignment-rule conditions, home-page layout). The registry's completeness
  test (FKs to `person` + Reference/Dynamic Reference columns) runs against
  the re-id too.
- **One transaction**, then a **post-check scan**: every registered column
  and every text/JSON column of every Table is searched for any old id; one
  hit aborts the transaction and the migration prints the column.
- **Sessions end at deploy** (the JWT `sub` changes); everyone signs in again
  once. **Tokens are rewritten** (`principal_id` → new id; the token secret is
  unchanged, so scripts keep working).
- `cli people:plan` prints the id map before the run; the map is also written
  to `person_id_map (old_id, new_id, kind)` so support can answer "who was
  RR-7963" — this table is **not** mirrored.

### R4. `user_identity` → `sign_in_identity`

Rename only (columns unchanged; `user_id` → `person_id`). The subject rewrite
to StyleHR record numbers is `person-resolution`'s (its C4).

### R5. CDC and warehouse plan (same release as the deploy)

- Registration: `featherbase.user` removed, `featherbase.person` added
  (schema `access`), `service_account` and `person_id_map` denied;
  `has_role`, `data_scope`, `share` keep flowing with their new columns.
- The worker drops `bronze_featherbase.access.user` and snapshots
  `access.person` on its next tick (a removed relation under
  `retirement_policy: freeze` is frozen, so the drop is explicit in the
  runbook).
- **Models to repoint** (data-warehouse#4336 owns the list): a grep of
  `dbt_runner/dbt/models` and `scripts` for `access.user` on 22-Oct-2026
  found **no** reader — reports key on employee codes, not on Featherbase ids.
  #4336 re-checks at release time and repoints anything that reads
  `bronze_featherbase.access.user`, `has_role.parent` or `data_scope.user` to
  `access.person`, `principal_id` and `principal_kind = 'person'`.

## Migration (`0101_person_rename.ts`, one transaction, rehearsable)

1. `create extension if not exists btree_gist` is **not** here (0102's).
2. Rename `user` → `person` and its indexes/constraints/trigger; rename
   `user_identity` → `sign_in_identity` (+ `person_id`); update `table_def`,
   `column_def`, `has_role.parenttype`, `data_scope`, `share`.
3. Create `service_account`; move `user_type = 'service'` rows; add
   `principal_kind`/`principal_id` to `access_token`, `data_scope`, `share`
   (backfilled `person`/`service_account` per row); drop `user_type`,
   `access_token.owner`.
4. Re-id (R3) with the post-check scan; write `person_id_map`.
5. `cli people:plan` prints the id map and every column the scan will visit.

DEPLOY.md order: #371's 0100 live → `people:plan` → snapshot → deploy (0101
runs; everyone signs in again) → CDC registration change → warehouse models
repointed → post-deploy counts: persons, service accounts, tokens by principal
kind, zero hits in the post-check scan.

## Risks

- **The re-id touches every table.** Bounded by the registry test and the
  post-check scan; dev is trial data; prod is empty.
- **A missed principal assumption** surfaces as a service-account regression;
  the R2 inventory and its test are the guard.
- **Everyone signs in again once.** Announced in the trial note.

## Test plan

`person-rename.test.ts`: tables renamed, Reference columns repointed,
`/api/users` gone; service accounts moved with tokens, roles, scope and shares;
principal check and trigger; `isPrivileged` for both kinds; pickers exclude
service accounts; `who(c)` writes principal ids. `token-hardening.test.ts`:
personal and service tokens resolve, disabled owners refused.
`migration-0101.test.ts`: dev-shaped fixture re-id, post-check scan catches a
planted old id, `people:plan` parity, idempotent re-run. Web: "Person" labels;
service-account list. Gates: typecheck, suites, `pnpm check:specs`,
`git diff --check`.
