# Tasks

Test-first throughout: each task writes its failing tests, then the code, then
runs the named files. Archive `delegated-password-login`,
`delegated-login-test-mode` and `fix-session-cookie-lifetime` before archiving
this change (it modifies requirements they add).

## 1. Storage and migration

- [ ] 1.1 `identities.ts`: `foldName`, reserved-domain test, the `user_identity` and Sign In Method helpers. Migration `0100_person_identities.ts` steps 1–4 and 6–7 (D2, D9, D11): Sign In Method Table + rows copied from System Settings, `user_identity` with constraints, FK to the method key (`on update cascade on delete restrict`) and the email-change trigger, email optional and normalised, duplicate check after clean-up, `user_email_lower_uq`, Custom Field relabel, System Settings columns dropped; `settings.ts` type and defaults trimmed; `document.ts` maps `user_email_lower_uq` to `email` by name. Verify `test/person-identities.test.ts`, `test/sign-in-methods.test.ts`.
- [ ] 1.2 Sign In Method controller: capability validation and the administrator lockout guard (D2). Verify `test/sign-in-methods.test.ts`.
- [ ] 1.3 Migration step 5 (narrow Google invites, delegated identities incl. duplicated login IDs with no sign-in name, skip/list rules) plus `cli identities:plan` dry run. Verify `test/migration-0100.test.ts` with the dev-shaped fixture; re-run is a no-op.

## 2. Sign-in pipeline

- [ ] 2.1 Sessions `{sub, exp, iat, m, idn?, tm?}`, one-query `resolveToken` (method enabled, hash present for password, identity owned), session user carries `{method, testMode, issuedAt}` (D8); password login: username beats email, case-insensitive, ambiguity refused. Verify `test/auth.test.ts`, `test/token-hardening.test.ts`, `test/pre-auth-rate-limit.test.ts`.
- [ ] 2.2 Google adapter keeps `sub` and `hd`; resolution by subject, eligibility before the invite claim, claim with audit (D5), `new_person` rules incl. `hd` (D4); mock provider gains an optional subject. Verify rewritten `test/oauth.test.ts`.
- [ ] 2.3 Delegated adapter through identities: lookup by folded sign-in name before the provider; test mode by folded subject with `tm` sessions; privileged refusal; `left` disables the person (D7); unavailable with no fallback; `method` required with two delegated methods. Verify `test/delegated-login.test.ts`.
- [ ] 2.4 Direct sign-up (no email) and the `SIGNUP` limiter (D10). Verify `test/signup.test.ts`.

## 3. Linking

- [ ] 3.1 Admin identity endpoints (list, link, invite, rename/move in one transaction, unlink); unlink and move end `idn` sessions, rename does not. Verify `test/identity-linking.test.ts`.
- [ ] 3.2 Self-link Google (`purpose = link`, `iat` within 15 minutes, collision and foreign-invite refusals); self unlink and remove-password with the user row locked and pending invites not counted; test-mode sessions refused for link, unlink, `/api/set_password` and `/api/access_tokens` (B1). Verify `test/identity-linking.test.ts`, `test/delegated-login.test.ts`, `test/access-tokens.test.ts`.

## 4. Email consumers

- [ ] 4.1 Stop inventing emails: service accounts, Administrator/Guest seeds (fresh installs), sales-target test accounts; `cli create-user` stores an email only when given one; `admin-bootstrap.ts` unchanged but covered by a test that a fresh Administrator with a hash can sign in. Verify `test/access-tokens.test.ts`, `test/sales-target.test.ts`, `test/cli.test.ts`, `test/admin-bootstrap*.test.ts`.
- [ ] 4.2 Password reset needs both an email and a password; workflow and SLA mails skip recipients without email; `SessionUser.email` nullable. Verify `test/password-reset.test.ts`, `test/workflow-notify.test.ts`, `test/sla.test.ts`, server typecheck.

## 5. Web

- [ ] 5.1 Login page renders methods from `/api/brand` `sign_in_methods`, keeps the test-mode form, shows sign-up when `sign_up_open`. Verify `apps/web/test/delegated-login.test.tsx`, new `apps/web/test/signup.test.tsx`.
- [ ] 5.2 Sign-in methods panel for the signed-in person (list, link Google, remove). Verify `apps/web/test/sign-in-methods.test.tsx`.
- [ ] 5.3 Playwright: update `e2e/oauth.spec.ts` to the Sign In Method row. Verify with the e2e suite.

## 6. Docs and close-out

- [ ] 6.1 `docs/DEPLOY.md` (replace the System Settings rows at 338–340 with Sign In Method rows; inviting a Google address; sign-up stays off until the `All` audit; the D11 deploy order) and a dated `PROGRESS.md` entry.
- [ ] 6.2 Gates: server and web typecheck, full server and web suites on an isolated database, web e2e, `pnpm check:specs`, `git diff --check`.
- [ ] 6.3 File the follow-ups: data-warehouse roster sync (design list), CDC `user_identity` deny/declare, drop `user.social_login`, remove the old `/api/brand` delegated fields, turn the reserved-domain shim into a 417, StyleHR response-subject check, `All`-role audit before sign-up, close `feat/244-provider-identities`.
