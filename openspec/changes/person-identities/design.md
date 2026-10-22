# Design

## Context

See `proposal.md` for why. The code this replaces, as of `origin/main` ce14c67:

| Today | Where |
|---|---|
| `User.email` is `reqd` + `unique` (constraint `user_email_uq`, case-sensitive) | `migrations/0005_core_seeds.ts`, `table-engine.ts` |
| Password sign-in looks the typed name up as `row_id = usr or email = usr` (case-sensitive) | `auth.ts` `login()` |
| Google drops the OIDC `sub` and links or creates a User **by email**; unknown people are created only when the email domain is in `allowed_login_domains`; `social_login = 'google'` is stamped | `oauth.ts` `exchangeCode`, `findOrCreateGoogleUser`, `domainAdmitted` |
| StyleHR (delegated password) binds the typed ID to the one User whose `delegated_login_user_column` (dev: the `stylehr_username` Custom Field) matches, **before** asking the provider; privileged, disabled, service and ambiguous accounts are refused | `delegated-login.ts` `linkedUser` |
| Test mode (`DELEGATED_LOGIN_TEST_MODE=trust-any-password`) skips the provider and matches the typed value against `row_id` (the employee code, by the roster sync's convention) | `delegated-login.ts` |
| Service accounts get `<slug>@service.invalid`; sales-target test accounts get `test_employee_N@example.invalid` | `service-accounts.ts`, `sales-target.ts` |
| Password reset mails `user.email ?? row_id`; workflow and SLA mails fall back to `row_id` as an address | `password-reset.ts`, `workflow.ts`, `jobs/sla-escalation.ts` |
| Sessions are stateless JWTs `{sub, exp}`; every request re-reads the User and refuses a disabled one | `auth.ts` `resolveToken` |

The data-warehouse roster sync (`scripts/sync_report_viewers_to_featherbase.py`,
branch `claude/affectionate-davinci-5lkukf`) creates staff as
`row_id = <employee code>`, `email = <code>@staff.jeyarama.invalid` (or a known
Google address), Custom Fields `employee_code` and `stylehr_username`, and
disables leavers with `--disable-leavers`. The trial instance has ~40 people
signing in through StyleHR every day, several in test mode.

`AGENTS.md` says nothing is deployed and nothing outside the repo needs
compatibility. That is no longer true for the dev instance: it has daily users
and a CDC mirror. This change therefore carries existing data over and keeps
every existing sign-in working with no user action, while still changing
in-repo shapes outright (no aliases).

## Goals / Non-Goals

**Goals**

- Person = User; email optional; no invented emails anywhere.
- One generic identity record per (sign-in method, provider subject); a person
  may have many. Provider code lives in small adapters.
- Per-method policies as configuration rows, defaulting to today's behaviour.
- Direct username + password sign-up (policy-gated, default off).
- Linking by an administrator or by the signed-in person; never by email match.
- Carry over every existing user and keep the trial instance's daily sign-in
  working, including test mode.

**Non-Goals**

- A "trust verified email" auto-link policy. Designed as an explicit opt-in,
  default off, and **not implemented** (account-takeover risk; no current need).
- Microsoft or other new providers, passkeys, Google `auth_time` freshness, a
  server-side session store with generations, operator-approved recovery. These
  were in the unmerged `secure-provider-identities` change (see below) and stay
  follow-ups.
- Reading a trusted subject out of StyleHR's sign-in response. Its success body
  is undocumented (`delegated-password-login` design), so the StyleHR adapter
  cannot create people or self-link; it only signs in pre-linked people.
- Partial offboarding. Disabling the person stays the one offboarding switch.

## Decisions

### D1. Two records: the person and their linked sign-ins

**User (the person)** keeps `row_id`, roles, Data Scope, assignments, audit.
Changes: `email` becomes optional; `social_login` stops being written (dropped
in a follow-up, see Compatibility).

**`user_identity` (new, raw platform table, like `access_token`)**

| column | meaning |
|---|---|
| `id` | `uid_` + random; also carried in sessions opened through it (D8) |
| `user_id` | → `user.row_id`, `on update cascade on delete cascade` |
| `method` | → Sign-in Method `key` (`password`, `google`, `stylehr`, …) |
| `subject` | the provider's permanent ID for the person; NULL only while a Google invite is pending (D5) |
| `sign_in_name` | what the person types, for methods where they type a name (password: username; StyleHR: their StyleHR login ID). Display attribute used **only** to find the candidate before credentials are checked |
| `email`, `display_name` | last values the provider returned; display only |
| `pending_email` | lower-cased address of an un-claimed Google invite |
| `linked_at`, `linked_by` | when / who (a user id, `migration`, `sign-up`, `self`, `first-sign-in`) |
| `last_used_at` | stamped on each successful sign-in through it |

Constraints (the database is the arbiter, not check-then-insert):

- `unique (method, subject)` — one subject → one person.
- `unique (method, lower(sign_in_name)) where sign_in_name is not null`.
- `unique (method, pending_email) where subject is null`.
- `check ((subject is null) = (pending_email is not null))`.
- One `password` identity per user: `unique (user_id) where method = 'password'`.

Subjects per method:

| method | subject | sign_in_name |
|---|---|---|
| Google | OIDC `sub` from userinfo (never the email) | — |
| StyleHR (delegated password) | employee code (`RR-7963`, `21654`) | StyleHR login ID (`name_9999999999`) |
| Featherbase password | opaque `pw_` + random, fixed at creation | the username (initially the User id) |

The password hash stays on `user.password_hash`; the `password` identity row is
what makes the method exist for that person. `setUserPassword` creates the row
if missing; removing the method clears the hash. One writer, one invariant.

*Why a raw table, not a metadata sub-table of User (invariant 1 tension):* the
generic save API replaces child rows wholesale and is writable by anyone with
User write access, so a roster PATCH could drop or forge links; sign-in stamps
`last_used_at` on every login, which must not create User versions; and
composite unique constraints are not expressible in Table metadata yet (#280).
`access_token` and `password_reset` set the precedent. Read access for the UI
goes through dedicated endpoints. Principle: consistency with existing
credential tables + security.

### D2. Sign-in methods are configuration rows

A new system Table **Sign-in Method** (module Core, System Manager only;
`system = true`, so it is not mirrored to the warehouse):

| column | values |
|---|---|
| `key` (row id) | slug; stable namespace for `user_identity.method` |
| `kind` | `password` \| `google` \| `delegated_password` (adapter selector) |
| `label` | shown on the sign-in page |
| `enabled` | off ⇒ the method's routes answer 404 and `/api/brand` omits it |
| `new_person` | `create` \| `create_if_email_domain_allowed` \| `refuse` |
| `allowed_email_domains` | comma list, `*` = any (for `create_if_email_domain_allowed`) |
| `self_link` | people may link this method themselves (default on) |
| `client_id` | Google client id (not a secret; the secret stays `GOOGLE_CLIENT_SECRET`) |
| `service_url` | delegated provider URL (same https / local-stub rule as today) |

Kind-specific validity, enforced by a controller on save:
`create_if_email_domain_allowed` only for `google` (only kind returning a
verified email); `delegated_password` allows only `refuse` and `self_link = 0`
(no trusted subject, see Non-Goals); `password` allows `create` (= sign-up
open) or `refuse`.

Seeded/migrated defaults reproduce today exactly: `password` enabled,
`new_person = refuse`; `google` enabled iff `google_client_id` was set,
`create_if_email_domain_allowed` with the old `allowed_login_domains`;
delegated method from `delegated_login_*` with `new_person = refuse`, key =
slug of its label (`stylehr` on dev). The mock Google provider stays the
`ALLOW_MOCK_OAUTH=1` environment opt-in and acts as the `google` method when
no `client_id` is set.

`/api/brand` returns `sign_in_methods: [{key, kind, label, test_mode}]` and
`sign_up_open`, replacing `delegated_login_label`/`delegated_login_test_mode`.
The System Settings columns `google_client_id`, `allowed_login_domains`,
`delegated_login_label|url|user_column` are removed by the migration after
their values are copied (no aliases, per AGENTS.md).

### D3. Adapters return a verified identity; one pipeline does the rest

```
adapter.verify(...) -> { subject?, sign_in_name?, email?, email_verified?, display_name?, status }
status ∈ verified | rejected | left | unavailable
```

Adapters: `password` (local hash), `google` (code exchange + userinfo; now
keeps `sub`), `mock` (dev; subject defaults to the typed email, optional
`subject` field for tests), `delegated_password` (today's
`checkWithProvider`, unchanged classification). None of them reads or writes
User. One shared `signInThrough(method, verified)` resolves the identity,
applies the method's policies, refuses ineligible people, stamps
`last_used_at`, issues the session (D8) and audits. The User model and the
pipeline know nothing about StyleHR or Google.

Resolution order inside the pipeline:

1. **Credential kinds** (`password`, `delegated_password`): find the identity
   by `(method, lower(trim(sign_in_name)))` **before** the adapter is asked —
   no candidate ⇒ password login's 401, credentials never checked or
   forwarded (keeps the no-oracle rule). Password sign-in also accepts the
   person's contact email as the typed name (today's behaviour), resolving to
   that person's `password` identity.
2. **Google**: `(google, sub)` linked ⇒ that person. Else a pending invite
   whose `pending_email` equals the **verified** email ⇒ claim it (D5). Else
   the `new_person` rule.
3. Eligibility (unchanged rules): disabled ⇒ refused; service account ⇒
   refused; via `delegated_password`, the Administrator or any System Manager
   ⇒ refused like a wrong password. Password and Google keep admitting
   privileged people, as today.

### D4. Policy for unknown subjects

- `refuse` (default for delegated and password): 401 like a wrong password
  for credential kinds; Google gets today's "Access not provisioned for this
  account. Contact IT."
- `create_if_email_domain_allowed` (Google default): today's
  `domainAdmitted` logic on the verified email.
- `create`: open.

A created person: `row_id` = lower-cased email for Google (today's shape) or
the chosen username for sign-up; `email` = the verified Google email, or the
optional address given at sign-up; `roles = []`; one linked identity. If the
`row_id` or the email is already taken by another person, creation is
**refused** ("contact your administrator") — it is never turned into a link.

### D5. Google `sub` bridge for existing users — pending invites

We hold only an email for existing Google users. The migration creates, for
every existing human user with a real (non-placeholder) email, a **pending
Google identity**: `subject NULL, pending_email = lower(email)`.

On a Google sign-in with verified email E and subject S, when `(google, S)` is
not linked: if a pending row has `pending_email = E`, then in one transaction
(row locked `for update`) set `subject = S`, clear `pending_email`,
`linked_by = 'first-sign-in'`, audit `identity_claimed`. The unique
`(method, subject)` index makes two concurrent claims of different invites by
one S fail cleanly. From then on that account is found **only** by S; the
email is never consulted again for it.

The same mechanism is the general "administrator links a Google account they
only know by address" (an *invite*): `POST …/identities {method: google,
email}`. Store-manager mailboxes and the roster sync's `--google-emails` use
it.

Safety argument: before the claim, the exposure is exactly today's (today
every sign-in matches by email); after the claim it is strictly smaller (a
recycled address with a new Google account gets a different `sub` and is
refused or treated as unknown). The pending row is bound to the address at
creation; an administrator who changes a person's contact email must re-invite
— the contact email never creates or moves a link on its own. Invites do not
expire (people sign in rarely; zero action required); an administrator can
delete one.

**Conflict to note for the owner.** The 22-Sep-2026 owner decision on #244
said existing email-only Google users get *controlled re-enrollment*, "not
silent subject backfill by email". The 22-Oct settled design chooses this
one-time bridge so nobody has to act. This design follows the newer decision;
the bridge is the only place an email ever selects an account, it fires at
most once per account, and it is no wider than today's behaviour.

### D6. Linking and unlinking

- **Administrator** (System Manager): `GET/POST/DELETE
  /api/users/:id/identities[/:identityId]`. Link StyleHR by
  `{method, subject, sign_in_name}`; Google by `{email}` (invite) or by
  `{subject}`; password by setting one (existing `/api/set_password`). Moving a
  link between people (e.g. a store mailbox when the Store Manager changes)
  is delete + link. Collisions answer 409 from the unique index.
- **Self** (signed-in person, method `self_link = 1`): Google — `GET
  /api/oauth/google/link` starts the same state + PKCE flow with
  `purpose = link` and the current user id inside the signed state; the
  callback re-checks the `sid` cookie is that same user, then links `(google,
  sub)`. Refused when: the session is older than 15 minutes (JWT gains `iat`;
  "sign in again first"), the subject is linked to anyone, or a pending invite
  for that verified email belongs to a *different* person. Password — setting
  your own password creates the `password` identity (today's
  `/api/set_password` already allows it). StyleHR cannot be self-linked (no
  trusted subject).
- **Unlink**: a person may remove their own method unless it is the last one
  (`409`); an administrator may remove any. Removing ends sessions opened
  through it (D8). Removing `password` clears the hash.
- **Never** auto-link by email. The opt-in per-method "trust verified email"
  policy is documented here and deliberately not built.

### D7. Leaver, outage, test mode

- **Leaver**: `delegated_password` → `left` is refused with today's 403 "no
  longer active", audited `sign_in_refused_left`; the identity is kept
  (history). Disabling the person stays the roster sync's job
  (`--disable-leavers`). Known gap, unchanged from today: a leaver who set a
  Featherbase password can still use it until the sync disables them.
- **Unavailable**: 503 "not responding … This is not your password" as today;
  the route never falls through to the local password or any other method.
- **Test mode** (`DELEGATED_LOGIN_TEST_MODE=trust-any-password`, env only):
  the adapter returns `verified` without calling the provider, and the
  candidate is found by `(method, subject)` = the typed employee code instead
  of `sign_in_name`. Disabled, service, unlinked and privileged accounts are
  still refused. For roster users `subject = row_id = employee code`, so
  testers type exactly what they type today.

### D8. Sessions record the method they came through

The session JWT gains `iat` and `via` (the identity id). `resolveToken` keeps
re-reading the User on each request and additionally, when `via` is present,
requires that identity to still exist and belong to `sub` (one PK lookup).
Tokens issued before the upgrade carry no `via` and stay valid until they
expire, so nobody is signed out by the deploy. Preview-link and access-token
sessions carry no `via`.

### D9. Email: optional, unique where present, never invented

- Metadata: `email` `reqd = false`. Replace `user_email_uq` with a unique index
  `user_email_lower_uq` on `lower(email)` where `email is not null`. The
  generic save's 23505 handler (`document.ts`) reads column names from the
  error detail, which for an expression index is `lower(email::text)`; it must
  map that index to the `email` field so the caller still gets "email must be
  unique" (417).
- Blank (`''`/whitespace) is stored as NULL.
- An address on a reserved, never-deliverable domain (`.invalid`, `.test`,
  `.example`, `.localhost`, `example.com/.net/.org` — RFC 2606/6761) is stored
  as NULL. This keeps the unchanged roster sync working (it still sends
  `@staff.jeyarama.invalid` for new staff) while nothing invented is kept.
- Seeds stop inventing: Administrator, Guest, service accounts and the
  sales-target test accounts get no email.

### D10. Direct sign-up

`POST /api/signup {username, password, full_name?, email?}`, public, behind a
new `publicLimit('SIGNUP')` bucket (`pre-auth-rate-limit.ts` gains the kind); 404 unless the `password` method's `new_person =
create`. Username: lower-case slug `^[a-z0-9][a-z0-9._-]{2,63}$`, not
`administrator`/`guest`, not an existing User id or `password` sign-in name
(case-insensitive) — taken ⇒ 409 "username taken" (inherent to username
sign-up; the limiter bounds probing). Password: the same minimum as reset.
Email optional and unverified, so it never links anything and never admits
by domain. Creates the person with `roles = []`, a `password` identity, signs
in like `/api/login`. Login page shows "Create an account" only when
`sign_up_open`.

## Use cases walked through

1. **Direct sign-up** — admin sets `password.new_person = create`; a visitor
   picks `meena` + password → User `meena` (no email), identity `(password,
   pw_…, sign_in_name = meena)`, signed in with no roles. Admin later grants
   roles.
2. **StyleHR-only staff** — roster sync creates User `RR-7963` (no email) and
   links `(stylehr, subject = RR-7963, sign_in_name = name_9999999999)`. They
   type their StyleHR ID + password; candidate found by sign-in name before
   StyleHR is asked; verified ⇒ session `via` that identity. Unknown StyleHR
   IDs get password login's 401 with no StyleHR call.
3. **StyleHR + Google, one person** — either the admin/sync invites the
   person's Google address (claimed at first Google sign-in) or the person,
   just signed in by StyleHR, links Google themselves. Both identities point at
   `RR-7963`; roles, scope and history are shared.

## Migration (one file, `0100_person_identities.ts`, idempotent)

Runs in one transaction; prints a summary (counts per step, every skipped row
with its reason). A `--dry-run` path (`cli identities:plan`) runs the same
code inside a rolled-back transaction for the dev rehearsal.

1. **Pre-check**: abort, listing them, if two users' emails collide
   case-insensitively after trimming. (Today's constraint is case-sensitive.)
2. Create `user_identity` with its indexes.
3. Create the Sign-in Method Table; insert `password`, `google` and (if
   configured) the delegated method from System Settings values (D2).
4. Email: `reqd = false`; blank and reserved-domain addresses → NULL;
   swap the constraint for the case-insensitive index.
5. Identities (service accounts excluded throughout):
   - `password` for every user with a `password_hash` (`sign_in_name =
     row_id`). Two users whose ids differ only by case: first by `row_id`
     keeps the name, the other gets `row_id` + suffix and is reported.
   - pending `google` invite for every user with a real email after step 4
     (enabled or disabled, so re-enabling works).
   - delegated method: for every user with a non-blank value in the old
     `delegated_login_user_column`: `subject = row_id`, `sign_in_name =
     trim(value)`. Duplicated sign-in names (refused at sign-in today with
     409) are skipped and reported. Users whose `row_id` is not their
     employee code are listed so the roster sync (or an admin) can relink —
     on dev the sync's convention makes `row_id` the employee code.
6. Drop the five System Settings sign-in columns.

Rollback: forward-fix only. Before the dev deploy take a database snapshot;
restoring it is the rollback.

## Compatibility and follow-ups

| Consumer | Effect | Action |
|---|---|---|
| REST `save_row`/PATCH on User with `email` | Still accepted; blank/reserved → NULL; case-insensitive duplicate → 417 field error | none |
| `/api/whoami`, login responses, web `SessionUser` | `email` becomes `string \| null` | in this change (web types, AdminLayout already guards) |
| `/api/brand` | new `sign_in_methods`, `sign_up_open`; old delegated fields removed | Login page in this change |
| `/api/login/delegated` | still works; optional `method` body field (defaults to the one enabled delegated method) | none |
| Password reset | no email or no password ⇒ silent no-op | in this change |
| Workflow / SLA mails | recipients without email are skipped, not mailed at their user id | in this change |
| `cli create-user <name> <pw>` | stores `email` only if the argument is an address | in this change |
| `tenancy.ts` site users | per-site schema, unchanged; out of scope | none |
| **Data-warehouse roster sync** (`scripts/sync_report_viewers_to_featherbase.py`) | **Required follow-up, ship right after the dev deploy.** (1) Stop sending `email` placeholders (send no `email` unless a real one is known). (2) After creating or finding a User, link StyleHR via `POST /api/users/<code>/identities {method: "stylehr", subject: <code>, sign_in_name: <stylehr_username>}`; on a changed StyleHR username, delete + relink. Until this runs, people the old script creates have no StyleHR link and cannot sign in. (3) Replace the "patch email when placeholder" Google path with an invite `{method: "google", email}` — setting a contact email no longer enables Google sign-in. (4) Store-manager mailboxes: when a store's manager changes, move the Google link (delete on the old person, invite on the new). (5) Keep `--disable-leavers`. The `stylehr_username` Custom Field may stay as roster data; sign-in no longer reads it. |
| CDC mirror of `user` into MotherDuck (`pg_md_cdc/registrations/featherbase.yml`) | Schema unchanged; `email` values for placeholder rows become NULL (an update per row). `user_identity` is a raw table (not catalog-declared) and the Sign-in Method Table is `system`, so neither flows | Warehouse follow-up: add `featherbase.user_identity` to the `deny` tripwire, or declare it if the warehouse wants "who signs in how". Anything joining on `user.email` must expect NULLs. |
| `user.social_login` | no longer written | Follow-up issue: drop the column once the CDC confirms it tolerates a dropped column |
| `feat/244-provider-identities` (unmerged, 263 commits behind main, no PR) | Superseded for this slice | Close after this lands; mine it for the follow-ups (revocable session store, Google `auth_time`, Microsoft) |

## Risks / Trade-offs

- **The Google bridge selects an account by email once** → bounded to
  pre-existing accounts and explicit invites, fires once, verified email only,
  audited; no wider than today (D5).
- **StyleHR binding still trusts the StyleHR login ID before the provider
  answers** (no trusted subject in the response) → unchanged from today; the
  roster sync must keep `sign_in_name` current. If StyleHR reassigns a login ID
  to another employee before the sync runs, the wrong person could sign in —
  as today. When the response carries an employee id the adapter can compare
  it to `subject` and refuse a mismatch; recorded as a follow-up once the
  success schema is known.
- **Employee-code uniqueness across StyleHR companies** — #275's evidence
  notes `employee_code` collisions in the HR feed (28). Within Featherbase the
  codes are already unique because they are User ids. If two companies'
  codes ever collide, give each company its own delegated method (`stylehr_kl`,
  `stylehr_tn`) — no schema change.
- **Leaver with a local password** keeps that way in until disabled (D7) →
  the sync's `--disable-leavers` is the backstop; the per-method `self_link`
  switch lets an instance stop staff adding passwords.
- **New roster users between deploy and the sync update cannot sign in** →
  deploy and run the updated sync back to back.
- **Moving sign-in settings into a Table** touches DEPLOY.md and tests →
  in-repo only; defaults reproduce today.

## Test plan

Server (Vitest, SQL sandbox, `apps/server/test/`):

- `person-identities.test.ts` — identity constraints (subject, sign-in name,
  pending, one password per user); case-insensitive email uniqueness; blank
  and reserved-domain emails stored as NULL; User saves with no email.
- `oauth.test.ts` (rewrite) — linked `sub` signs in; changed Google email,
  same `sub` ⇒ same person; same email, different `sub` with no invite ⇒
  never that account (unknown-person rule); pending invite claimed once and
  then ignored (second account with same email but new `sub` refused);
  concurrent claims; domain rule; `create`/`refuse`; creation refused when id
  or email taken; disabled person refused and not re-enabled.
- `delegated-login.test.ts` (adapt) — every existing case through identities:
  unlinked ⇒ 401 with provider never called; privileged/disabled refused;
  left ⇒ 403; unavailable ⇒ 503 and no password fallback even when the person
  has a local password; password absent from logs; test mode matches subject,
  refuses privileged/disabled/unlinked, ignores the StyleHR login name.
- `signup.test.ts` — closed ⇒ 404; open ⇒ account + session, no roles; taken
  username (any case) ⇒ 409; reserved names; rate limit.
- `identity-linking.test.ts` — admin link/unlink/invite/move; 409 on
  collision; self-link Google happy path; stale session ⇒ refused; subject
  linked elsewhere ⇒ refused; invite on another person ⇒ refused; cannot
  remove last method; unlink ends sessions `via` it; legacy token without
  `via` still valid.
- `password-reset.test.ts` — no email or no password ⇒ no mail, same answer.
- `workflow`/`sla` — recipients without email skipped.
- `migration-0100.test.ts` — fixture with the dev shapes (placeholder staff,
  Google user with real email, StyleHR-linked staff incl. duplicate sign-in
  name, service account, case-colliding ids, test-account emails): asserts
  every identity created, every placeholder cleared, settings rows copied,
  System Settings columns gone, re-run is a no-op, collision pre-check aborts.

Web (`apps/web/test/`, RTL): Login renders methods from `/api/brand`;
sign-up link only when open; test-mode notice; sign-in methods panel
(list/link/remove, last-method refusal message).

E2E (Playwright, mock Google): sign in by StyleHR stub → link Google via mock
→ sign out → sign in by mock Google with a *changed* email and the same
subject → same account.

Gates: `pnpm --filter server typecheck`, `pnpm --filter web typecheck`, full
server suite on an isolated database, `pnpm check:specs`, `git diff --check`.

Dev verification (orchestrator/owner; this change touches no Railway
environment):

1. Snapshot the dev database. Run `cli identities:plan` against a restored copy;
   check counts: one `stylehr` identity per roster user (≈264), one pending
   Google invite per real-email user, zero remaining `.invalid` emails, the
   skip list.
2. Deploy; as a Team Leader, sign in by StyleHR test mode with the employee
   code; open the sales-target report; scope unchanged.
3. A Google user signs in; their pending invite becomes a linked `sub`
   (audit `identity_claimed`); second sign-in does not consult email.
4. Run the updated roster sync; a new staff member appears with a StyleHR
   link and no email and can sign in.
5. Check the CDC mirror's next run is green and `email` shows NULL for staff.
