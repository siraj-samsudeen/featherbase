# Tasks

Test-first throughout: each task writes its failing tests, then the code, then
runs the named files. Archive `delegated-password-login`,
`delegated-login-test-mode` and `fix-session-cookie-lifetime` before archiving
this change (it modifies requirements they add).

## 1. Storage and migration

- [x] 1.1 `identities.ts` (folding, `.invalid` rule, method and identity records); migration 0100: Sign In Method Table + rows from System Settings, `user_identity` with constraints, FK to the method key and the email-change trigger, email optional and normalised, duplicate check after clean-up, `user_email_lower_uq`, Custom Field relabel, System Settings columns dropped, Activity Log `sign_in_method`/`test_mode`; `settings.ts` trimmed; `document.ts` maps `user_email_lower_uq` to `email` by name; `table-engine.ts` refuses a column-level unique on User.email. Verify `test/person-identities.test.ts`, `test/sign-in-methods.test.ts`.
- [x] 1.2 Sign In Method controller: capability validation, unique kinds, delegated wire-format validation, and the lockout guard counting only usable methods (incl. blanking Google's client id). Verify `test/sign-in-methods.test.ts`, `test/identity-review.test.ts`.
- [x] 1.3 Read-only `planPersonIdentities` (names, ids, parity check) shared by `cli identities:plan` and the migration; Google invites only for `social_login = 'google'`, on the email or the address-shaped id; delegated key from the provider host and on/off exactly as before; seed emails cleared. Verify `test/migration-0100.test.ts`.

## 2. Sign-in pipeline

- [x] 2.1 One pipeline (`sign-in.ts` `completeSignIn`) for every kind; sessions `{sub, exp, iat, m, idn?, tm?, pv?}`; one-query `resolveToken`; password verify step (username beats email, dummy scrypt). Verify `test/auth.test.ts`, `test/token-hardening.test.ts`, `test/person-identities.test.ts`.
- [x] 2.2 Google verify step keeps `sub`/`hd`, drops unverified addresses; resolution by subject, invite claim with eligibility first, `new_person` rules incl. `hd`; race losers re-read; refusal reasons logged. Verify `test/oauth.test.ts`, `test/person-identities.test.ts`, `test/identity-concurrency.test.ts`.
- [x] 2.3 Delegated verify step with the wire format from `settings` (StyleHR defaults); lookup before the provider; test mode by subject; `left` disables; no fallback; `method` required with two delegated rows. Verify `test/delegated-login.test.ts`, `test/identity-review.test.ts`.
- [x] 2.4 Direct sign-up (username and password only, folded) through the pipeline, `SIGNUP` limiter. Verify `test/signup.test.ts`.

## 3. Linking

- [x] 3.1 Admin identity endpoints (list, link, invite, rename/move, unlink) with 200 on repeats, 409 details, actor-correct audit, and lockout checks on unlink/move. Verify `test/identity-linking.test.ts`, `test/identity-review.test.ts`.
- [x] 3.2 Self-link Google (fresh session; every outcome explained); self unlink and remove-password under a row lock, privileged delegated links not counted; `assertCanChangeAccess` for test-mode, preview and pre-upgrade sessions on set_password, access tokens, link, unlink, remove-password; first password needs a fresh session. Verify `test/identity-linking.test.ts`, `test/identity-review.test.ts`, `test/identity-concurrency.test.ts`.

## 4. Email consumers

- [x] 4.1 No invented emails: service accounts, sales-target viewers, `cli create-user <username>`, the Guest session, the 0005 seeds (cleared by 0100); a fresh Administrator with only a hash signs in. Verify `test/cli.test.ts`, `test/sales-target.test.ts`, `test/identity-linking.test.ts`, `test/identity-review.test.ts`.
- [x] 4.2 Password reset needs an email and a password; workflow and SLA mails skip people without email and log the count; `SessionUser.email` nullable; mention suggestions show the name. Verify `test/password-reset.test.ts`, `test/workflow-notify.test.ts`, `test/sla.test.ts`, server typecheck.

## 5. Web

- [x] 5.1 Login page from `/api/brand` (Google still offered if it cannot be read), service forms, forgot-password hint, no password toggle when passwords are off, sign-up. Verify `apps/web/test/delegated-login.test.tsx`, `apps/web/test/signup.test.tsx`.
- [x] 5.2 Sign-in methods page; User-form panel for System Managers; account-menu, sidebar and sales-target links. Verify `apps/web/test/sign-in-methods.test.tsx`.
- [x] 5.3 Playwright: `e2e/oauth.spec.ts` on the Sign In Method row, and `e2e/login-methods.spec.ts` (password sign-in → link mock Google → sign in with a changed address, same account). Verified by the CI e2e job (run 39793477625).

## 6. Docs and close-out

- [x] 6.1 `docs/DEPLOY.md` (Sign In Method rows, linking, wire format, the mandatory deploy runbook, the test-mode warning) and `PROGRESS.md`.
- [x] 6.2 Gates: server and web typecheck, full server and web suites, web e2e, `pnpm check:specs`, `git diff --check` — green in CI.
- [x] 6.3 File the follow-ups: CDC `user_identity` deny/declare, drop `user.social_login`, remove the old `/api/brand` fields, `.invalid` → 417, StyleHR response-subject check, `All`-role audit before sign-up, close `feat/244-provider-identities` — filed as #372–#378. (The roster sync is filed in the data-warehouse repo.)
