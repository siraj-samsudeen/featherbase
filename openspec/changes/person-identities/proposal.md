# Proposal

## Why

Every Featherbase account must have a unique email today. Store staff have no
email, so the roster sync makes one up for each of them
(`<employee code>@staff.jeyarama.invalid`): 264 of the 277 accounts on the
trial instance carry an address that cannot receive mail. Google sign-in finds
people by that same email, so an email is doing two jobs: contact address and
the key to someone's account. Neither job works for staff, and the second one
is unsafe for everyone.

The owner wants one general design, not a StyleHR special case (Siraj,
22-Oct-2026): people can sign up directly with a username and password; staff
can sign in with only their HR system ID; and a person who has both an HR
system ID and a Google account is one Featherbase user.

## What Changes

- **An account is a person.** Roles, data scope, assignments and history stay
  on the account exactly as today.
- **Email becomes optional contact data.** When present it is unique, ignoring
  case. Addresses on domains reserved to never receive mail are not kept, so
  no account carries an invented address. Existing placeholder addresses are
  cleared.
- **Linked sign-in methods.** A person can have several ways to sign in, each
  linked to their account by the provider's permanent ID for them (Google's
  account ID, the HR system's employee code, or a local username), never by
  email or display name. Each link records when and by whom it was made and
  when it was last used.
- **Sign-in methods become configuration.** Password, Google and the connected
  HR system are rows an administrator edits, each with its own rule for a
  person it does not recognise: make an account, make one only for allowed
  email domains, or refuse. Defaults keep today's behaviour.
- **Direct sign-up with a username and password**, off unless an
  administrator turns it on.
- **Linking.** An administrator links or removes a sign-in method for anyone.
  A signed-in person can link another method themselves by proving it.
  Nothing is ever linked because two email addresses match.
- **Existing sign-ins keep working with no action by anyone.** HR system IDs
  and passwords carry over as linked methods. A Google account that used to
  be matched by its address is linked to its permanent ID on its next sign-in,
  once; after that its address is never used to find the account again.
  Test mode for the HR system keeps working and still refuses privileged
  accounts.
- **BREAKING (internal):** the System Settings sign-in columns
  (`google_client_id`, `allowed_login_domains`, `delegated_login_*`) move to
  the new sign-in method rows; `/api/brand` lists enabled methods instead of
  one delegated label. The data-warehouse roster sync must write linked
  sign-ins instead of placeholder emails (listed in design).

## Capabilities

### Modified Capabilities

- `sign-in-and-accounts`: optional email; one person with several linked
  sign-in methods; per-method rules for new people; direct sign-up; linking
  and unlinking; carrying existing sign-ins over. Builds on the unarchived
  changes `delegated-password-login`, `delegated-login-test-mode` and
  `fix-session-cookie-lifetime`, which archive first.

## Impact

- `apps/server`: one migration (identity store, sign-in method rows, optional
  email, data carry-over); `oauth.ts`, `delegated-login.ts`, `auth.ts`,
  `password-reset.ts`, `service-accounts.ts`, `sales-target.ts`, workflow and
  SLA mail recipients; new sign-up and link/unlink routes.
- `apps/web`: Login page renders methods from configuration and offers sign-up
  when open; a sign-in methods panel on the account and on the User form.
- Outside the repo: the data-warehouse roster sync and the `user` table mirror
  (CDC). Details and required follow-ups are in design.md.
- Supersedes the unmerged `feat/244-provider-identities` branch's
  `secure-provider-identities` change for this slice (see design).
