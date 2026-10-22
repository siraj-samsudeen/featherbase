# Tasks

Test-first throughout: each task writes its failing tests, then the code, then
runs the named files. Archive `delegated-password-login`,
`delegated-login-test-mode` and `fix-session-cookie-lifetime` before archiving
this change (it modifies requirements they add).

## 1. Storage and migration

- [ ] 1.1 Migration `0100_person_identities.ts` steps 1–2 and 4: email pre-check (abort listing case-insensitive duplicates), `user_identity` table with its constraints (design D1), `email` optional, blank/reserved-domain emails → NULL, `user_email_uq` replaced by `user_email_lower_uq`; map that index to the `email` field in `document.ts`'s 23505 handler; add the reserved-domain/blank normalisation to User saves. Verify `test/person-identities.test.ts`.
- [ ] 1.2 Sign-in Method system Table + controller enforcing kind-specific policy values (D2); migration step 3 copies System Settings values; step 6 drops the five System Settings columns. Verify `test/sign-in-methods.test.ts`.
- [ ] 1.3 Migration step 5 (password identities, pending Google invites, delegated identities, skip/report rules) plus `cli identities:plan` dry run. Verify `test/migration-0100.test.ts` with the dev-shaped fixture; re-run is a no-op.

## 2. Sign-in pipeline

- [ ] 2.1 Adapter seam and `signInThrough` (D3), sessions with `iat` + `via` and the `via` check in `resolveToken` (D8); password login through its identity (username or contact email, case-insensitive). Verify `test/auth.test.ts`, `test/token-hardening.test.ts`, `test/pre-auth-rate-limit.test.ts`.
- [ ] 2.2 Google adapter keeps `sub`; resolution by subject, pending-invite claim (D5), `new_person` rules (D4); mock provider gains an optional subject. Verify rewritten `test/oauth.test.ts`.
- [ ] 2.3 Delegated adapter through identities: lookup by sign-in name before the provider, test mode by subject, privileged refusal, left/unavailable unchanged, no fallback; optional `method` on `/api/login/delegated`. Verify `test/delegated-login.test.ts`.
- [ ] 2.4 Direct sign-up route and `SIGNUP` limiter (D10). Verify `test/signup.test.ts`.

## 3. Linking

- [ ] 3.1 Admin identity endpoints (list, link StyleHR, invite/link Google, unlink, move) and self unlink with last-method refusal; unlink ends `via` sessions. Verify `test/identity-linking.test.ts`.
- [ ] 3.2 Self-link Google (`purpose = link` state, 15-minute session freshness, collision and foreign-invite refusals); setting your own password creates the `password` identity. Verify `test/identity-linking.test.ts`.

## 4. Email consumers

- [ ] 4.1 Stop inventing emails: service accounts, Administrator/Guest seeds, sales-target test accounts; `cli create-user` stores an email only when given one. Verify `test/access-tokens.test.ts` (service accounts), `test/sales-target.test.ts`, `test/cli.test.ts`.
- [ ] 4.2 Password reset needs both an email and a password; workflow and SLA mails skip recipients without email; `SessionUser.email` nullable. Verify `test/password-reset.test.ts`, `test/workflow-notify.test.ts`, `test/sla.test.ts`, server typecheck.

## 5. Web

- [ ] 5.1 Login page renders methods from `/api/brand` `sign_in_methods`, keeps the test-mode form, shows sign-up when `sign_up_open`; sign-up form posts `/api/signup`. Verify `apps/web/test/delegated-login.test.tsx`, new `apps/web/test/signup.test.tsx`.
- [ ] 5.2 Sign-in methods panel for the signed-in person (list, link Google, remove) and on the User form for System Managers (plus link StyleHR / invite Google). Verify `apps/web/test/sign-in-methods.test.tsx`.
- [ ] 5.3 Playwright: StyleHR stub sign-in → link mock Google → sign in with the same subject and a changed email → same account. Verify `apps/web/e2e/login-methods.spec.ts`.

## 6. Docs and close-out

- [ ] 6.1 `docs/DEPLOY.md`: Sign-in Method rows replace the System Settings columns; how to open sign-up; how to invite a Google address; roster-sync contract. Dated `PROGRESS.md` entry.
- [ ] 6.2 Gates: `pnpm --filter server typecheck`, `pnpm --filter web typecheck`, full server suite on an isolated database, `pnpm check:specs`, `git diff --check`.
- [ ] 6.3 File the follow-ups: data-warehouse roster sync (design, Compatibility), CDC deny/declare `user_identity`, drop `user.social_login`, StyleHR response-subject check, close `feat/244-provider-identities`.
