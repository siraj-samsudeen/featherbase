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
shapes outright. **No compatibility shims** (Siraj, 22-Oct-2026: "the first real
prod move — start everything cleanly"): old `/api/brand` fields, silently
dropped placeholder emails, pre-upgrade sessions and `user.social_login` are
all gone at the upgrade; existing data is migrated, nothing old is accepted.

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
**`row_id` is the permanent person id** — the warehouse `person_id` — and
must never change: renaming a User is refused by `renameDoc` and by a trigger
(`fc_person_id_is_permanent`, bypassable only by a migration that sets
`featherbase.allow_person_id_change = 'on'`). People Featherbase creates — a
Google `new_person` sign-in, a sign-up — get an opaque id (`usr_` + 20 hex);
the address stays in `email`, a chosen sign-in name in the new `username`
column (unique ignoring case), and the display name in `full_name`. Existing
ids (including the ~13 email-shaped ones) stay as they are: forward-only.
`email` becomes optional (D9). `social_login` is read once by migration 0100
(D5) and dropped by it.

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
| `settings` | JSON, kind-specific configuration. Used today by `delegated_password` for the provider's wire format (D3); a future kind keeps its extras here (a Microsoft tenant, SAML metadata) without a schema change |

A controller validates each save against the **kind's declared
capabilities** (`KINDS` in `identities.ts`), not a list of kinds:

- `create` needs a kind that vouches for a permanent subject (`google`,
  `password`).
- `create_if_email_domain_allowed` needs a kind that returns a verified
  email (`google`).
- `self_link` needs a trusted subject; `delegated_password` allows only
  `new_person = refuse`, `self_link = 0`.
- `password` and `google` are unique kinds: a second row is refused (409).
  The `password` row cannot be deleted. A method that linked sign-ins still
  use cannot be deleted (409); turn it off instead.
- A `delegated_password` row's `settings` must parse as a wire format.
- **Lockout guard:** turning a method off, deleting it, or blanking Google's
  `client_id` is refused while any enabled Administrator/System Manager who
  has a way in now would have none afterwards; so are an administrator's
  unlink or move of such a person's link. A "way in" counts only methods that
  can actually sign someone in — enabled, and for Google a client id or the
  dev mock — and never a delegated link for a privileged person (they never
  sign in through it) or a pending invite. The error names the people.

Defaults reproduce today exactly: `password` enabled with `new_person =
refuse` (sign-up closed); `google` enabled **only if** it can work — a client
id, or the `ALLOW_MOCK_OAUTH=1` mock — with `create_if_email_domain_allowed`
and the old `allowed_login_domains`. The controller refuses any change that
leaves an enabled method unusable (Google without a client id, a delegated
method without an https/local address); turn it off instead. The kinds and
`new_person` values come from one shared list (`SIGN_IN_METHOD_KINDS`,
`NEW_PERSON_RULES` in `packages/shared`): the server's `KINDS` record, the
Table's choices, the controller's messages and the web client's types derive
from it, so a missing kind is a compile error. The delegated row is migrated with exactly the
old on/off state (on only with a usable URL **and** a User column), its key
taken from the provider host's first label (`stylehr.in` → `stylehr`, not the
label), `new_person = refuse`, `self_link = 0`, and StyleHR's wire format
written into `settings`.

`/api/brand` returns `sign_in_methods: [{key, kind, label, test_mode}]`,
`sign_up_open`, and `identity_links: true` (the marker the roster sync probes,
D11). The old `delegated_login_label` / `delegated_login_test_mode` fields are
gone. The System Settings columns `google_client_id`,
`allowed_login_domains`, `delegated_login_label|url|user_column` are removed
after their values are copied.

### D3. Each kind verifies; one pipeline does the rest

`sign-in.ts` is the one post-verification pipeline. A kind supplies only a
verify step returning

```
VerifiedIdentity = { status, subject?, sign_in_name?, email?, email_verified?, display_name?, hosted_domain? }
status ∈ verified | rejected | left | unavailable
```

and `completeSignIn(method, verified, found)` does the rest for every kind:
status handling (rejected → 401; unavailable → 503 naming the method, never
another method; left → disable the person, D7), resolving the person (D5:
linked subject → one-time invite → the method's `new_person` rule), the
eligibility check, stamping the identity, issuing the session with `m`/`idn`/`tm`
(D8) and the login audit row (method, test mode). Sign-up ends in the same
call. Self-linking is `linkVerifiedToSelf`, also kind-neutral.

Verify steps today:

- **password** (`passwordSignIn`): finds the candidate by typed name — an exact
  User id, then a case-insensitive id or `username` (same rank: an id and
  another person's username tying there answers nobody), then a
  case-insensitive contact email;
  **a username always beats an email**; two people at the same level answer
  nobody — then checks the hash. With no candidate it still runs a throwaway
  scrypt, so timing does not tell names apart.
- **google** (`exchangeCode`): code exchange + userinfo; keeps `sub` and `hd`;
  an unverified address is neither stored nor used. The dev mock returns the
  same shape (optional `subject` and `hd` fields).
- **delegated_password** (`checkWithProvider`): finds the candidate by its
  linked sign-in name (test mode: by subject) **before** asking the provider,
  so an unlinked ID is never forwarded (no oracle). The request field names and
  every success / error / left rule come from the row's `settings`
  (`DelegatedWire`), defaulting to StyleHR's values; a second HR provider with
  a different wire format is a new row, not code. With two or more delegated
  Every delegated sign-in names its `method` (no single-service default).

**What a new OIDC provider (e.g. Microsoft) still needs** — stated plainly, not
built: a `KINDS` entry declaring its capabilities, its verify step (authorize
URL + code exchange + claims → VerifiedIdentity, including which claim is the
permanent subject and how its issuer/tenant is checked), and its login,
callback and link routes (today those three routes are Google's). Everything
after verification — policies, invites, linking, lockout, sessions, audit,
the Admin panels — is shared and needs nothing.

Eligibility (shared): disabled ⇒ refused; service account ⇒ refused;
privileged through a kind with `admitsPrivileged = false` (delegated) ⇒
refused like a wrong password. For an invite, eligibility runs on its owner
**before** the claim, so an invite is never claimed onto a disabled or service
account.

### D4. Policy for unknown subjects

- `refuse`: credential kinds answer password login's 401; Google answers
  today's "Access not provisioned for this account. Contact IT."
- `create_if_email_domain_allowed`: the adapter must return a verified email
  on an allowed domain. For Google, a non-consumer domain must also match the
  token's hosted-domain claim (`hd`), so a personal Google account registered
  on a company address is not admitted as that company; `gmail.com` and
  `googlemail.com` have no `hd` and are admitted only when listed.
- `create`: open.

A created person: `row_id` = an opaque `usr_` id; Google ⇒ `email` = the
verified email, `full_name` = Google's display name; sign-up ⇒ `username` =
the chosen name, no email. `roles = []`. If the address is already some
account's email or id, creation is refused ("contact your administrator") —
never turned into a link.

### D5. Google `sub` bridge for existing Google users — narrow, one-time

We hold only an email for existing Google users. The migration creates a
**pending Google invite** (`subject NULL`, `pending_email = foldName(address)`)
**only for users with `social_login = 'google'`** — people who have actually
signed in with Google. The address is their real email after D9's clean-up,
or, when the email is empty, their User id if that is an address (old Google
sign-ups were created with the address as the id; review A-M3). When the id
and the email are different addresses, the invite is on the email and the
person is listed in the plan. Everyone else with a real email (e.g. store mailboxes set by the
roster sync's `--google-emails` but never used) is **listed** in the migration
report for an explicit administrator invite.

Claiming, on a sign-in with verified email E and subject S when
`(method, S)` is not linked (any kind with `verifiedEmail`):

- eligibility of the invite's owner first (D3 step 4);
- then, in one transaction with the invite row locked `for update`: set
  `subject = S`, clear `pending_email`, `linked_by = 'first-sign-in'`;
- audit `identity_claimed` on the owner with method, subject and time;
- the unique `(method, subject)` index decides concurrent claims; a loser
  with the same subject re-reads and signs in as the winner, and concurrent
  first sign-ins that create a person do the same (review minor 5).

From then on the account is found **only** by S. Administrators undo a claim
by unlinking (D6).

Invites are cancelled automatically: a database trigger on `user` deletes
**every** unclaimed invite the person holds whenever their `email` is set,
changed or cleared (ignoring case and spaces), whatever address the invite was
for (Codex P1 on #371) — through the Admin, the generic API or the roster
sync. An administrator re-invites deliberately after an email change.
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

Administrator (System Manager) endpoints, each single-transaction; every one
is audited with the administrator as the actor and the person in the text
(review B-M1):

- `GET /api/users/:id/identities` — the person's linked identities and pending
  invites, and whether they have a password.
- `POST /api/users/:id/identities` — `{method, subject, sign_in_name?}` (e.g.
  StyleHR), `{method: google, email}` (invite) or `{method: google, subject}`.
  Re-posting the same link or invite answers **200** with it (the roster sync
  can repeat itself); a new one answers 201; a clash answers **409** with
  `fields = {clash: subject | sign_in_name | invite, identity, user}`.
- `PATCH /api/identities/:identityId` — `{sign_in_name?, user_id?}`: rename a
  StyleHR login ID (the identity id stays, so nobody is signed out) or move a
  link to another person (store mailbox handover); a move ends sessions opened
  through it and may not lock out an administrator.
- `DELETE /api/identities/:identityId` — unlink (also the undo for a claim);
  may not lock out an administrator.

Self (signed-in person, method `self_link = 1`):

- `GET /api/oauth/google/link` starts the usual state + PKCE flow with
  `purpose = link` and the user id inside the signed state; the callback
  re-checks the `sid` cookie is that same user, then links. Every outcome —
  including a failed code exchange — returns to the Sign-in methods page as a
  code it explains (`linked`, `taken`, `reserved`, `sign_in_again`,
  `not_allowed`, `google_failed`, `wrong_session`).
- Refused when the session cannot change access (D8), is older than 15
  minutes, the subject is linked to anyone, or another person holds an invite
  for that verified email.
- `DELETE /api/me/identities/:identityId` and `DELETE /api/me/password`:
  refused for sessions that cannot change access, and when it would leave no
  working way in. The user row is locked `for update` while counting, so two
  concurrent removals cannot both pass; pending invites do not count, and for
  an Administrator or System Manager a delegated link does not count.
- Setting your own password (`/api/set_password`): refused for sessions that
  cannot change access; adding a first password needs a sign-in within 15
  minutes (it adds a way in); changing an existing one does not.

Never auto-link by email. The opt-in per-method "trust verified email" policy
is documented and deliberately not built.

### D7. Leaver, outage, test mode

- **Leaver**: when a verify step answers `left`, the pipeline sets the
  person's `enabled = false` through the normal row save (so a Version is
  recorded, history kept), audits `disabled_as_leaver`, and answers 403 "no
  longer active". `resolveToken` refuses disabled people, so **every**
  session they hold ends on its next request and every other method (password,
  Google) refuses them. Re-enabling is an administrator's decision.
- **Unavailable**: 503 "not responding … This is not your password"; never
  falls through to the local password or any other method.
- **Test mode** (`DELEGATED_LOGIN_TEST_MODE=trust-any-password`, env only):
  the verify step returns `verified` without calling the provider; the
  candidate is found by `lower(subject) = foldName(typed)`. Disabled, service,
  unlinked and privileged accounts are still refused. For roster users
  `subject = row_id = employee code`, so testers type exactly what they type
  today.

### D8. Sessions record how they were opened

The session JWT is `{sub, exp, iat, m, idn?, tm?, pv?}`: `m` = sign-in method
key, `idn` = identity id, `tm` = test mode, `pv` = a dev-preview click-through.
`resolveToken` keeps one query per request (User left-joined to method and
identity) and refuses when the User is disabled, the method `m` is disabled or
gone, `m` is the password method and the hash is now NULL, or `idn` no longer
exists or no longer belongs to `sub`. The session user carries `sign_in =
{method, identity, test_mode, preview, issued_at}`.

**Pre-upgrade sessions end at the deploy.** A token without `iat` (every
token minted before this change) is rejected by `resolveToken`; everyone signs
in once more. **Sessions that cannot change access** (`assertCanChangeAccess`,
reviews B1, B-M2): a test-mode session and a preview session may read but
cannot set a password, mint an access token, link or unlink a sign-in method,
or remove a password. Access tokens (no `sign_in`) are integration
credentials and are unaffected.

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
- An address on the `.invalid` top-level domain (RFC 2606's never-resolving
  name, used by every placeholder this codebase and the roster sync ever
  invented) is **refused** with a field error (417) on every path: a User
  save, a Google invite, and a person a sign-in would create.
- A `username` (generic save or sign-up) is a lowercase slug and may not equal
  another person's id, username or email, ignoring case; nor may a new id. The
  migration clears the existing ones (data, not a shim). Other reserved names
  (`example.com`, `.test`) are accepted: tests use them as stand-ins. The
  updated roster sync must send no email rather than a placeholder.
- Code stops inventing: service accounts, the sales-target test accounts and
  the in-code Guest session get no email. The 0005 seed addresses of
  Administrator and Guest (`admin@example.com`, `guest@example.com`) are
  cleared by migration 0100 (0005 itself is never edited).

### D10. Direct sign-up

`POST /api/signup {username, password}` — **nothing else** (any other field is
a 417), so nobody can squat an address; the display name starts as the
username. Public, behind a new `publicLimit('SIGNUP')`
bucket; 404 unless the `password` method's `new_person = create`. Username:
`^[a-z0-9][a-z0-9._-]{2,63}$` after folding to lower case (a capital typed by
habit is folded, not refused), not `administrator`/`guest`, not an existing
User id or `username` (case-insensitive) ⇒ 409 "username taken" (inherent to username
sign-up; the limiter bounds probing). Password: the same minimum as reset.
Creates the person with `roles = []` and finishes through the same pipeline
as every sign-in. The Login page shows "Create an account" only when
`sign_up_open`.

**Sign-up stays off on every instance until the implicit `All` role has been
audited** — what every signed-in person can read today must be known before
strangers can become signed-in people. That audit is a follow-up.

### D11. Deploy window, the runbook, and the roster sync

`identity_links: true` in `/api/brand` tells the roster sync the identity API
exists. Order on dev (mandatory runbook, also in DEPLOY.md):

1. Freeze the old roster sync (do not run it).
2. Run `cli identities:plan` against dev. It is read-only and prints, by name
   and id, every email it will clear, every Google invite, everyone **listed
   for an explicit invite** (real email, never signed in with Google — review
   A-M4 keeps them out of the automatic bridge on purpose), and a **parity
   check**: how many people can sign in today, how many keep a way in, and
   each exception.
3. Snapshot the database; deploy Featherbase (the migration runs).
4. **Immediately invite every listed person** (User form → Sign-in methods →
   invite, or `POST /api/users/<id>/identities {method:"google", email}`).
5. Run the updated roster sync, which refuses to run unless `/api/brand`
   reports `identity_links`.

The old delegated User column's Custom Field (`stylehr_username` on dev) is
relabelled "<label> ID (roster copy — sign-in uses linked identities)" by the
migration; sign-in no longer reads it.

### D12. Screens

- **Sign-in methods** (`/featherbase/admin/sign-in-methods`): the signed-in
  person's password, linked accounts and pending invites, with Remove and
  "Link a Google account"; reachable from the account menu, the sidebar and
  the sales-target report header, so a Team Leader can self-link.
- **User form** (System Managers only): a Sign-in methods panel listing the
  person's identities and pending invites, with link a connected service
  (employee code + login ID), invite a Google address, and unlink (with a
  confirmation). Moving a link stays an API call.
- **Login page**: buttons for each enabled method from `/api/brand` (Google is
  still offered if `/api/brand` cannot be read), the delegated form, sign-up
  when open, a "<service> users reset their password in <service>" hint under
  Forgot password, and no "use email and password instead" when passwords are
  off.

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

## Migration (`0100_person_identities.ts`, idempotent)

`planPersonIdentities()` is read-only and computes the whole plan from the
data as it is; `cli identities:plan` prints it (no DDL, no exclusive locks).
`migratePersonIdentities()` computes the same plan first and applies it, so the
rehearsal and the run cannot disagree. Steps:

1. Abort, listing them, if two addresses would collide ignoring case **after**
   the clean-up in step 4.
2. Create the Sign In Method Table and its rows (D2).
3. Create `user_identity` (indexes, FK to the method key `on update cascade on
   delete restrict`), the email-change trigger, and two Activity Log columns
   (`sign_in_method`, `test_mode`) for login rows.
4. Email: `reqd = false`, `unique = false`; trim; clear blank, `.invalid` and
   the two 0005 seed addresses; swap `user_email_uq` for `user_email_lower_uq`.
5. Identities (service accounts excluded): the planned Google invites (D5;
   anyone who already has a Google identity is skipped, so a re-run after a
   claim is a no-op) and the planned delegated links (`subject = row_id`,
   `sign_in_name = trim(value)`; people sharing a login ID — refused at sign-in
   today — are still linked, with no sign-in name, and reported). No password
   rows: the hash is the method.
6. Relabel the old User column's Custom Field (D11).
7. Drop the five System Settings sign-in columns.

Rollback: forward-fix only; restore the pre-deploy snapshot if needed.

## Compatibility and follow-ups

| Consumer | Effect | Action |
|---|---|---|
| REST `save_row`/PATCH on User with `email` | still accepted; blank/reserved → NULL; case-insensitive duplicate → 417 `email` | none |
| `/api/whoami`, login responses, web `SessionUser` | `email` is `string \| null`; `whoami` gains `sign_in` `{method, test_mode}` | web types in this change |
| `/api/brand` | `sign_in_methods`, `sign_up_open`, `identity_links`; the old delegated fields are removed | web client in this change |
| `/api/login/delegated` | `method` is required (no single-service default) | web client in this change; any script posting here must send it |
| `/api/set_password`, `/api/access_tokens` | refused for test-mode sessions | none (B1) |
| Password reset | no email or no password ⇒ silent no-op | in this change |
| Workflow / SLA mails | recipients without email are skipped, and the skip count is logged | in this change |
| Activity log | identity rows record the ACTOR as the user (an administrator's link is theirs) with the target in the operation text; login rows record the method and test mode | in this change |
| `cli create-user <name> <pw>` | stores `email` only if the argument is an address | in this change |
| `tenancy.ts` site users | per-site schema, out of scope | none |
| **Data-warehouse roster sync** | see the list below — **required**, runs right after the deploy | follow-up issue |
| CDC mirror of `user` (`pg_md_cdc/registrations/featherbase.yml`) | schema unchanged; placeholder emails become NULL; `user_identity` (raw) and Sign In Method (`system`) do not flow | warehouse follow-up: add `featherbase.user_identity` to `deny`, or declare it; joins on `user.email` must expect NULL |
| `user.social_login` | read once and dropped by migration 0100 | the CDC mirror sees a dropped column on its next run |
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
