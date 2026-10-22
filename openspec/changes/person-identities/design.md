# Design

## Context

See `proposal.md` for why. The code this replaces, as of `origin/main` ce14c67:

| Today | Where |
|---|---|
| `User.email` is `reqd` + `unique` (constraint `user_email_uq`, case-sensitive) | `migrations/0005_core_seeds.ts`, `table-engine.ts` |
| Password sign-in looks the typed name up as `row_id = usr or email = usr` (case-sensitive, arbitrary pick if both match different people) | `auth.ts` `login()` |
| Google drops the OIDC `sub` and links or creates a User **by email**; unknown people are created only when the email domain is in `allowed_login_domains`; `social_login = 'google'` is stamped on every Google sign-in | `oauth.ts` `exchangeCode`, `findOrCreateGoogleUser`, `domainAdmitted` |
| StyleHR (delegated password) binds the typed ID to the one User whose `delegated_login_user_column` (dev: the `stylehr_username` Custom Field) matches `lower(trim())`, **before** asking the provider; privileged, disabled, service and ambiguous accounts are refused | `delegated-login.ts` `linkedUser` |
| Test mode (`DELEGATED_LOGIN_TEST_MODE=trust-any-password`) skips the provider and matches `lower(row_id) = lower(trim(typed))` | `delegated-login.ts` |
| A test-mode session is an ordinary session: it can call `/api/set_password` on itself (no current password asked) and mint access tokens | `index.ts` |
| Service accounts get `<slug>@service.invalid`; sales-target test accounts get `test_employee_N@example.invalid` | `service-accounts.ts`, `sales-target.ts` |
| Password reset mails `user.email ?? row_id`; workflow and SLA mails fall back to `row_id` as an address | `password-reset.ts`, `workflow.ts`, `jobs/sla-escalation.ts` |
| Sessions are stateless JWTs `{sub, exp}`; every request re-reads the User and refuses a disabled one | `auth.ts` `resolveToken` |
| `password_hash` is written by `setUserPassword`, `admin-bootstrap.ts`, migration 0006 and several tests directly | — |

The data-warehouse roster sync (`scripts/sync_report_viewers_to_featherbase.py`,
branch `claude/affectionate-davinci-5lkukf`) creates staff as
`row_id = <employee code>`, `email = <code>@staff.jeyarama.invalid` (or a known
Google address), Custom Fields `employee_code` and `stylehr_username`, and
disables leavers with `--disable-leavers`. The trial instance has ~40 people
signing in through StyleHR every day, several in test mode.

`AGENTS.md` says nothing is deployed and nothing outside the repo needs
compatibility. That is no longer true for the dev instance: it has daily users
and a CDC mirror. This change therefore carries existing data over and keeps
every existing sign-in working with no user action, while changing in-repo
shapes outright, with one exception kept for one release (D2, `/api/brand`).

## Goals / Non-Goals

**Goals**

- Person = User; email optional; no invented emails anywhere.
- One generic identity record per (sign-in method, provider subject) for
  outside providers; a person may have many. Provider code lives in small
  adapters.
- Per-method policies as configuration rows, defaulting to today's behaviour.
- Direct username + password sign-up (policy-gated, default off).
- Linking by an administrator or by the signed-in person; never by email match.
- Carry over every existing user and keep the trial instance's daily sign-in
  working, including test mode — nobody who can sign in today is skipped.

**Non-Goals**

- A "trust verified email" auto-link policy. An explicit opt-in, default off,
  **not implemented** (account-takeover risk; no current need).
- Microsoft or other new providers, passkeys, Google `auth_time` freshness, a
  server-side session store, operator-approved recovery. These were in the
  unmerged `secure-provider-identities` change (see Compatibility) and stay
  follow-ups. The `settings` column (D2) lets them arrive without a schema
  change.
- Reading a trusted subject out of StyleHR's sign-in response. Its success body
  is undocumented (`delegated-password-login` design), so the StyleHR adapter
  cannot create people or be self-linked; it only signs in pre-linked people.
- Partial offboarding. Disabling the person stays the one offboarding switch.

## Decisions

### D1. The person, their password, and their linked outside identities

**User (the person)** keeps `row_id`, roles, Data Scope, assignments, audit.
`email` becomes optional (D9). `social_login` stops being written; it is read
once, by the migration (D5), and dropped in a follow-up.

**Password = `user.password_hash` (one home, derived method).** A non-null
hash IS the password sign-in method; there is no password identity row. The
username is the User id (`row_id`). Every existing writer
(`setUserPassword`, `admin-bootstrap.ts`, migration 0006, tests) keeps working
unchanged, `diagnoseAdminBootstrap` already tests exactly this predicate, and
a fresh install's Administrator is never locked out by a missing row. Removing
the password method clears the hash. Principle: simplest robust rule — one
writer path, zero migration of secrets (decision principles: consistency,
cheaper).

**`user_identity` (new raw platform table, like `access_token`) — outside
providers only (Google, delegated password, future OIDC/SAML).**

| column | meaning |
|---|---|
| `id` | `uid_` + random; carried in sessions opened through it (D8) |
| `user_id` | → `user.row_id`, `on update cascade on delete cascade` |
| `method` | → `sign_in_method.row_id`, `on update cascade on delete restrict` |
| `subject` | the provider's permanent ID; NULL only while a Google invite is pending (D5) |
| `sign_in_name` | what the person types at a credential provider (StyleHR login ID). Used **only** to find the candidate before credentials are forwarded |
| `email`, `display_name` | last values the provider returned; display only |
| `pending_email` | folded address of an un-claimed Google invite |
| `linked_at`, `linked_by` | when / who (a user id, `migration`, `self`, `first-sign-in`, `new-person`) |
| `last_used_at` | stamped on each successful sign-in through it |

Constraints (the database is the arbiter, not check-then-insert):

- `unique (method, subject)`.
- `unique (method, lower(sign_in_name)) where sign_in_name is not null`.
- `unique (method, pending_email) where subject is null`.
- `check ((subject is null) = (pending_email is not null))`.

Subjects per method:

| method | subject | found by |
|---|---|---|
| Google | OIDC `sub` from userinfo (never the email) | `sub` |
| StyleHR (delegated password) | employee code (`RR-7963`, `21654`) | `sign_in_name` = StyleHR login ID; test mode: `subject` |
| Featherbase password | the User id (derived, no row) | User id or contact email (D3) |

**Case folding lives in one helper** (`foldName(s) = s.trim().toLowerCase()`,
`identities.ts`) used for every typed-name, sign-in-name, subject-in-test-mode
and email comparison, and by the indexes' `lower()` (values are stored
trimmed).

*Why a raw table, not a metadata sub-table of User (invariant 1 tension):* the
generic save replaces child rows wholesale and is writable by anyone with
User write access, so a roster PATCH could drop or forge links; sign-in stamps
`last_used_at` on every login, which must not create User versions; and
composite unique constraints are not expressible in Table metadata yet (#280).
`access_token` and `password_reset` set the precedent.

### D2. Sign-in methods are configuration rows

A new system Table **Sign In Method** (`featherbase.sign_in_method`, module
Core, `system = true`; no Permission rows, so System Manager only; not mirrored
to the warehouse). **One row = one provider issuer** (one Google client, one HR
endpoint); two StyleHR companies would be two rows.

| column | values |
|---|---|
| `row_id` (key) | slug, stable namespace for `user_identity.method` |
| `kind` | `password` \| `google` \| `delegated_password` (selects the adapter) |
| `label` | shown on the sign-in page |
| `enabled` | off ⇒ its routes answer 404, `/api/brand` omits it, and sessions opened through it end (D8) |
| `new_person` | `create` \| `create_if_email_domain_allowed` \| `refuse` |
| `allowed_email_domains` | comma list, `*` = any |
| `self_link` | people may link this method themselves |
| `client_id` | Google client id (not a secret; the secret stays `GOOGLE_CLIENT_SECRET`) |
| `service_url` | delegated provider URL (same https / local-stub rule as today) |
| `settings` | JSON, kind-specific extras for future kinds (Microsoft tenant, SAML metadata) |

A controller validates each save against the **adapter's declared
capabilities**, not a list of kinds:

- `create` needs an adapter that returns a trusted subject (`google`,
  `password`).
- `create_if_email_domain_allowed` needs an adapter that returns a verified
  email (`google`).
- `self_link` needs a trusted subject (`google`); `delegated_password`
  allows only `new_person = refuse`, `self_link = 0`.
- Only one row per `password` kind; the `password` row cannot be deleted.
- **Lockout guard (M5):** turning a method off, or deleting it, is refused
  while any enabled Administrator/System Manager who has a way in now would
  have none afterwards. A "way in" is a hash with the password method enabled,
  or a claimed identity on an enabled non-delegated method (delegated never
  admits them; pending invites never count). The error names the people.

Defaults reproduce today exactly: `password` enabled with `new_person =
refuse` (sign-up closed); `google` enabled iff `google_client_id` was set
(else disabled; the `ALLOW_MOCK_OAUTH=1` mock serves as `google` when there is
no `client_id`, as today), `create_if_email_domain_allowed` with the old
`allowed_login_domains`; the delegated method from `delegated_login_*`, key =
slug of its label (`stylehr` on dev), `new_person = refuse`, `self_link = 0`.

`/api/brand` returns `sign_in_methods: [{key, kind, label, test_mode}]`,
`sign_up_open`, and `identity_links: true` (the marker the roster sync probes,
D11). It **keeps** `delegated_login_label` and `delegated_login_test_mode` for
one release so an old web bundle in a browser tab keeps working; removal is a
follow-up. The System Settings columns `google_client_id`,
`allowed_login_domains`, `delegated_login_label|url|user_column` are removed
after their values are copied.

### D3. Adapters return a verified identity; one pipeline does the rest

```
adapter.verify(...) -> { subject?, sign_in_name?, email?, email_verified?, hosted_domain?, display_name?, status }
status ∈ verified | rejected | left | unavailable
capabilities: { trustedSubject, verifiedEmail }
```

Adapters: `google` (code exchange + userinfo; now keeps `sub` and `hd`),
`mock` (dev; subject defaults to the typed email, optional `subject` field for
tests), `delegated_password` (today's `checkWithProvider`, unchanged
classification), and the password check. None of them reads or writes User.
One shared pipeline resolves the candidate, checks eligibility, applies the
policy, stamps `last_used_at`, issues the session (D8) and audits. The User
model and the pipeline know nothing about StyleHR or Google.

Resolution and order of checks:

1. **Password** (`/api/login`): one query finds the candidate — an exact User
   id first, then a case-insensitive User id, then a case-insensitive contact
   email; **a username always beats an email** (minor 5). Two different
   people matching at the same level ⇒ the generic 401. Then the hash check.
2. **Delegated password** (`/api/login/delegated`): `method` is optional
   when exactly one delegated method is enabled and **required** when two or
   more are (400 otherwise). The candidate is found by
   `(method, lower(sign_in_name)) = foldName(typed)` — test mode: by
   `lower(subject)` — **before** the adapter is asked. No candidate ⇒ 401,
   password never forwarded.
3. **Google**: `(google, sub)` linked ⇒ that person. Else a pending invite
   whose `pending_email` = the **verified** email ⇒ claim (D5). Else the
   `new_person` rule (D4).
4. **Eligibility before anything is written**: disabled ⇒ refused; service
   account ⇒ refused; through a delegated method, the Administrator or any
   System Manager ⇒ refused like a wrong password. For a Google invite this
   check runs on the invite's owner **before** the claim, so an invite is
   never claimed onto a disabled or service account.
5. **Outcomes**: `left` ⇒ D7; `unavailable` ⇒ 503 and no other method is
   tried; `rejected` ⇒ 401.

### D4. Policy for unknown subjects

- `refuse`: credential kinds answer password login's 401; Google answers
  today's "Access not provisioned for this account. Contact IT."
- `create_if_email_domain_allowed`: the adapter must return a verified email
  on an allowed domain. For Google, a non-consumer domain must also match the
  token's hosted-domain claim (`hd`), so a personal Google account registered
  on a company address is not admitted as that company; `gmail.com` and
  `googlemail.com` have no `hd` and are admitted only when listed.
- `create`: open.

A created person: Google ⇒ `row_id` = folded email, `email` = the verified
email; sign-up ⇒ `row_id` = the username, no email. `roles = []`. If the
`row_id` or the email is already taken, creation is refused ("contact your
administrator") — never turned into a link.

### D5. Google `sub` bridge for existing Google users — narrow, one-time

We hold only an email for existing Google users. The migration creates a
**pending Google invite** (`subject NULL`, `pending_email = foldName(email)`)
**only for users with `social_login = 'google'`** — people who have actually
signed in with Google — that are human and have a real email after D9's
clean-up. Everyone else with a real email (e.g. store mailboxes set by the
roster sync's `--google-emails` but never used) is **listed** in the migration
report for an explicit administrator invite.

Claiming, on a Google sign-in with verified email E and subject S when
`(google, S)` is not linked:

- eligibility of the invite's owner first (D3 step 4);
- then, in one transaction with the invite row locked `for update`: set
  `subject = S`, clear `pending_email`, `linked_by = 'first-sign-in'`;
- audit `identity_claimed` on the owner with method, subject and time;
- the unique `(method, subject)` index makes concurrent claims fail cleanly.

From then on the account is found **only** by S. Administrators undo a claim
by unlinking (D6).

Invites are cancelled automatically: a database trigger on `user` deletes the
person's unclaimed invites whenever their `email` changes or is cleared, so a
contact-email edit — through the Admin, the generic API or the roster sync —
can never leave an invite pointing at an address the person no longer holds.
Invites do not expire otherwise.

The same pending-invite mechanism is how an administrator links a Google
account known only by address (D6).

**Owner decision recorded.** The 22-Sep-2026 owner note on #244 asked for
controlled re-enrollment of email-only Google users, "not silent subject
backfill by email". This design **deliberately supersedes** that note under
the 22-Oct-2026 owner delegation (Siraj approved the orchestrator's
recommendations for every design choice), bounded as above: only people who
already signed in with Google, verified email only, eligible owner only,
once, audited, undoable, and cancelled by any email change. Before the claim
the exposure equals today's (today every Google sign-in matches by email);
after it, it is strictly smaller.

### D6. Linking and unlinking

Administrator (System Manager) endpoints, all single-transaction:

- `GET /api/users/:id/identities` — the person's linked identities, pending
  invites, and a derived `password` entry.
- `POST /api/users/:id/identities` — `{method, subject, sign_in_name?}` (e.g.
  StyleHR), or `{method: google, email}` (invite), or `{method: google,
  subject}`. Collisions ⇒ 409 naming the existing link.
- `PATCH /api/identities/:identityId` — `{sign_in_name?, user_id?}`: change a
  StyleHR login ID, or move a link to another person (store mailbox handover),
  atomically. A rename keeps the identity id, so nobody is signed out; a move
  ends sessions opened through it for the old owner (D8).
- `DELETE /api/identities/:identityId` — unlink (also the undo for a claim).

Self (signed-in person, method `self_link = 1`):

- `GET /api/oauth/google/link` starts the usual state + PKCE flow with
  `purpose = link` and the user id inside the signed state; the callback
  re-checks the `sid` cookie is that same user, then links `(google, sub)`.
- Refused when: the session is a test-mode session (D7); the session has no
  `iat` or is older than 15 minutes ("sign in again first"); the subject is
  linked to anyone; or another person holds an invite for that verified email.
- `DELETE /api/me/identities/:identityId` and "remove my password" (clears the
  hash): refused for test-mode sessions; refused when it would leave no way
  in. The user row is locked `for update` while counting, so two concurrent
  removals cannot both pass; pending invites do not count as a way in.
- Setting your own password (`/api/set_password` on yourself) creates the
  password method; refused for test-mode sessions.

Never auto-link by email. The opt-in per-method "trust verified email" policy
is documented and deliberately not built.

### D7. Leaver, outage, test mode

- **Leaver**: when the delegated adapter answers `left`, the pipeline sets the
  person's `enabled = false` through the normal row save (so a Version is
  recorded, history kept), audits `disabled_as_leaver`, and answers today's 403
  "no longer active". `resolveToken` refuses disabled people, so **every**
  session they hold ends on its next request and every other method (password,
  Google) refuses them. Re-enabling is an administrator's decision.
- **Unavailable**: 503 "not responding … This is not your password" as today;
  never falls through to the local password or any other method.
- **Test mode** (`DELEGATED_LOGIN_TEST_MODE=trust-any-password`, env only):
  the adapter returns `verified` without calling the provider; the candidate is
  found by `lower(subject) = foldName(typed)`. Disabled, service, unlinked and
  privileged accounts are still refused. For roster users `subject = row_id =
  employee code`, so testers type exactly what they type today. **Test-mode
  sessions carry `tm: true`** and cannot: link or unlink a method, set any
  password, or mint an access token (B1). This also closes a hole that is live
  on dev today.

### D8. Sessions record how they were opened

The session JWT becomes `{sub, exp, iat, m, idn?, tm?}`: `m` = sign-in method
key, `idn` = identity id (outside providers), `tm` = test mode. `resolveToken`
keeps one query per request (User left-joined to method and identity) and
refuses when the User is disabled (today), the method `m` is disabled or gone,
`m` is the password method and the hash is now NULL, or `idn` no longer exists
or no longer belongs to `sub`. The session user carries `{method, testMode,
issuedAt}` so routes can apply D6/D7.

Tokens issued before the upgrade carry no `m`/`idn`: they stay valid until
expiry (nobody is signed out by the deploy) and are **not** ended by unlinking
or disabling a method — only by disabling the person. They count as stale for
self-linking. Preview-link sessions carry `m = 'preview'` semantics today's
code already has (no `idn`), and access tokens are unchanged.

### D9. Email: optional, unique where present, never invented

- Metadata: `email` `reqd = false` and `unique = false` in `column_def`. The
  case-insensitive index `user_email_lower_uq` on `lower(email)` (where
  `email is not null`) is the only uniqueness rule. `User` is a system Table,
  so `updateTable` already refuses column edits that could re-add a
  case-sensitive `user_email_uq`; a test pins that.
- The 23505 handler in `document.ts` maps `user_email_lower_uq` **by
  constraint name** to the `email` field (an expression index's detail reads
  `lower(email::text)`), so callers still get "email must be unique" (417).
- Blank (`''`/whitespace) is stored as NULL.
- **Time-boxed shim:** an address on a reserved, never-deliverable domain
  (`.invalid`, `.test`, `.example`, `.localhost`, `example.com/.net/.org` —
  RFC 2606/6761) is stored as NULL, so the old roster sync cannot break during
  the deploy window. Follow-up: once the sync is updated, refuse such addresses
  with 417 instead.
- Seeds stop inventing: Administrator, Guest, service accounts and the
  sales-target test accounts get no email.

### D10. Direct sign-up

`POST /api/signup {username, password, full_name?}` — **no email in v1**, so
nobody can squat an address. Public, behind a new `publicLimit('SIGNUP')`
bucket; 404 unless the `password` method's `new_person = create`. Username:
`^[a-z0-9][a-z0-9._-]{2,63}$`, not `administrator`/`guest`, not an existing
User id (case-insensitive) ⇒ 409 "username taken" (inherent to username
sign-up; the limiter bounds probing). Password: the same minimum as reset.
Creates the person with `roles = []`, signs in like `/api/login`. The Login
page shows "Create an account" only when `sign_up_open`.

**Sign-up stays off on every instance until the implicit `All` role has been
audited** — what every signed-in person can read today must be known before
strangers can become signed-in people. That audit is a follow-up.

### D11. Deploy window and the roster sync

`identity_links: true` in `/api/brand` tells the roster sync the identity API
exists. Order on dev:

1. Freeze the old roster sync (do not run it).
2. Snapshot the database; deploy Featherbase (the migration runs).
3. Run the updated roster sync, which refuses to run unless `/api/brand`
   reports `identity_links`.

The `stylehr_username` Custom Field (whichever column `delegated_login_user_column`
named) is relabelled "StyleHR ID (roster copy — sign-in uses linked
identities)" by the migration; sign-in no longer reads it.

## Use cases walked through

1. **Direct sign-up** — admin sets `password.new_person = create` (after the
   `All` audit); a visitor picks `meena` + password → User `meena`, no email,
   hash set, signed in with no roles.
2. **StyleHR-only staff** — roster sync creates User `RR-7963` (no email) and
   links `(stylehr, subject = RR-7963, sign_in_name = name_9999999999)`. They
   type their StyleHR ID, any case; candidate found before StyleHR is asked;
   verified ⇒ session `{m: stylehr, idn}`. Unknown IDs get the 401 with no
   StyleHR call.
3. **StyleHR + Google, one person** — the admin/sync invites the person's
   Google address (claimed at first Google sign-in), or the person, freshly
   signed in by StyleHR (not test mode), links Google themselves. Both
   identities point at `RR-7963`.

## Migration (`0100_person_identities.ts`, idempotent, one transaction)

Prints a summary (counts per step; every skipped or listed row with its
reason). `cli identities:plan` runs the same code inside a rolled-back
transaction and prints the same summary.

1. Create the Sign In Method Table; insert `password`, `google` and (if
   configured) the delegated method from System Settings (D2).
2. Create `user_identity`, its indexes, FK, and the email-change trigger.
3. Email: `reqd = false`, `unique = false`; trim; blank and reserved-domain
   addresses → NULL.
4. **Then** the case-insensitive duplicate check: abort, listing them, if two
   remaining emails collide ignoring case; otherwise swap `user_email_uq` for
   `user_email_lower_uq`.
5. Identities (service accounts excluded):
   - pending Google invites: users with `social_login = 'google'` and a real
     email, **skipping anyone who already has any Google identity** (so a
     re-run after a claim is a no-op). Other real-email users are listed.
   - delegated method: every user with a non-blank old
     `delegated_login_user_column` value gets `subject = row_id`,
     `sign_in_name = trim(value)`. When two users share a value (refused with
     409 at sign-in today), **both are still migrated** with `sign_in_name =
     NULL` (test mode still finds them by subject) and are reported. Users whose
     `row_id` is not their employee code are listed for relinking.
   - No password rows: the hash is the method.
6. Relabel the old user column's Custom Field (D11).
7. Drop the five System Settings sign-in columns.

Rollback: forward-fix only; restore the pre-deploy snapshot if needed.

## Compatibility and follow-ups

| Consumer | Effect | Action |
|---|---|---|
| REST `save_row`/PATCH on User with `email` | still accepted; blank/reserved → NULL; case-insensitive duplicate → 417 `email` | none |
| `/api/whoami`, login responses, web `SessionUser` | `email` is `string \| null`; `whoami` gains `sign_in` `{method, test_mode}` | web types in this change |
| `/api/brand` | new `sign_in_methods`, `sign_up_open`, `identity_links`; old delegated fields kept one release | follow-up: remove them |
| `/api/login/delegated` | unchanged; optional `method`, required with ≥2 delegated methods | none |
| `/api/set_password`, `/api/access_tokens` | refused for test-mode sessions | none (B1) |
| Password reset | no email or no password ⇒ silent no-op | in this change |
| Workflow / SLA mails | recipients without email are skipped | in this change |
| `cli create-user <name> <pw>` | stores `email` only if the argument is an address | in this change |
| `tenancy.ts` site users | per-site schema, out of scope | none |
| **Data-warehouse roster sync** | see the list below — **required**, runs right after the deploy | follow-up issue |
| CDC mirror of `user` (`pg_md_cdc/registrations/featherbase.yml`) | schema unchanged; placeholder emails become NULL; `user_identity` (raw) and Sign In Method (`system`) do not flow | warehouse follow-up: add `featherbase.user_identity` to `deny`, or declare it; joins on `user.email` must expect NULL |
| `user.social_login` | no longer written | follow-up: drop once CDC tolerates it |
| `feat/244-provider-identities` (unmerged, no PR) | superseded for this slice | close; mine for Microsoft, `auth_time`, session store |

**Roster sync changes (data-warehouse, follow-up, do not edit here):**

1. Refuse to run unless `GET /api/brand` returns `identity_links: true`.
2. Create Users with no `email` key unless a real address is known.
3. For each active person with a StyleHR login: `POST
   /api/users/<code>/identities {method: "stylehr", subject: <code>,
   sign_in_name: <stylehr_username>}`; on 409 because it already exists for
   that person, compare and, if the login ID changed, `PATCH
   /api/identities/<id> {sign_in_name}`.
4. Replace the "patch email when placeholder" Google path with an invite
   `POST /api/users/<code>/identities {method: "google", email}`; a contact
   email no longer enables Google sign-in.
5. Store mailboxes: when a store's manager changes, `PATCH
   /api/identities/<id> {user_id: <new manager>}` (atomic, no sign-out of
   others), or invite if none exists.
6. Keep `--disable-leavers` (still the backstop, though the leaver path in D7
   now disables people on their next sign-in).
7. Stop writing `stylehr_username` as the sign-in key (it may stay as data).

## Risks / Trade-offs

- **The Google bridge selects an account by email once** → narrowed to people
  who signed in with Google, eligible owners, verified email, once, audited,
  undoable, auto-cancelled on email change (D5).
- **StyleHR binding trusts the StyleHR login ID before the provider
  answers** — unchanged from today. If StyleHR reassigns a login ID before the
  sync renames the link, the wrong person could sign in. Follow-up: compare the
  employee id in StyleHR's response with `subject` once its success schema is
  known.
- **Employee-code collisions across StyleHR companies** (#275 evidence: 28 in
  the feed) — unique inside Featherbase because codes are User ids; if two
  companies' codes collide, give each its own method row (D2).
- **Disabling on `left` is triggered by an unauthenticated request** — only
  after the provider has accepted that person's password, so only the person
  (or someone holding their password) can trigger it, and it is what an
  administrator would do anyway.
- **New roster users between deploy and the sync update cannot sign in** →
  the D11 order.
- **Moving sign-in settings into a Table** touches DEPLOY.md and tests →
  in-repo only; defaults reproduce today.

## Test plan

Server (Vitest, SQL sandbox, `apps/server/test/`):

- `person-identities.test.ts` — identity constraints; case-insensitive email
  uniqueness with the 417 on `email`; blank/reserved emails stored as NULL;
  User saves with no email; the email-change trigger cancels invites; `User`
  column edits refused.
- `sign-in-methods.test.ts` — capability validation; lockout guard
  (password off while the Administrator has only a password ⇒ refused, names
  them); disabling a method ends its sessions; FK restrict on delete.
- `auth.test.ts` — username beats email; case-insensitive; ambiguity ⇒ 401;
  removing the password ends password sessions; legacy token still valid.
- `oauth.test.ts` (rewrite) — linked `sub`; changed email, same `sub`; same
  email, different `sub` with no invite ⇒ unknown-person rule; invite claimed
  once then ignored; no claim onto a disabled or service owner; concurrent
  claims; `hd` rule; `create`/`refuse`; creation refused when id or email
  taken.
- `delegated-login.test.ts` (adapt) — every existing case through identities;
  case/whitespace-insensitive; `left` disables the person and ends their
  other sessions; unavailable ⇒ 503 with no fallback; test mode by subject;
  test-mode session cannot set a password, mint a token or link Google;
  `method` required with two delegated methods.
- `signup.test.ts` — closed ⇒ 404; open ⇒ account + session, no email, no
  roles; email field ignored/refused; taken username ⇒ 409; reserved names;
  rate limit.
- `identity-linking.test.ts` — admin link/invite/rename/move/unlink, 409s;
  self-link happy path; stale or `iat`-less session ⇒ refused; subject linked
  elsewhere ⇒ refused; foreign invite ⇒ refused; last-method refusal under
  concurrency; unlink ends `idn` sessions; rename keeps them.
- `password-reset.test.ts`, `workflow-notify.test.ts`, `sla.test.ts`,
  `access-tokens.test.ts`, `cli.test.ts`, `sales-target.test.ts` — the email
  consumers.
- `migration-0100.test.ts` — dev-shaped fixture (placeholder staff, a Google
  user with `social_login`, a real-email user without it, a duplicated StyleHR
  login, service account, case-variant emails that only collide after
  clean-up): every person migrated or listed with a reason; re-run no-op.

Web: Login renders methods from `/api/brand`; sign-up only when open;
test-mode notice; sign-in methods panel. E2E: `oauth.spec.ts` updated to the
Sign In Method row; `login-methods.spec.ts` StyleHR stub → link mock Google →
changed email, same subject → same account.

Gates: server and web typecheck, full server and web suites on an isolated
database, the web e2e suite, `pnpm check:specs`, `git diff --check`.

Dev verification (orchestrator/owner; this change touches no Railway
environment): D11 order; then a Team Leader signs in by StyleHR test mode;
a Google user's invite becomes a linked `sub` (audit `identity_claimed`);
the updated sync links a new staff member; the CDC run stays green.
