# Tasks

## 1. Session and Cookie Expiry

- [x] 1.1 Add failing HTTP regressions for password, Google, and preview sign-in that configure distinct session lengths, assert each `sid` cookie's `Max-Age` matches its token lifetime, cover one hour and 720 hours, and preserve `HttpOnly`, `SameSite=Lax`, and `Path=/`; verify the focused tests fail on the fixed seven-day implementation.
- [x] 1.2 Factor session token creation into one auth helper that reads and clamps the configured duration once and returns the token with its lifetime; verify focused auth tests cover the existing eight-hour fallback and 1–720 hour bounds.
- [x] 1.3 Pass the issued lifetime through the shared cookie helper from all three sign-in routes while keeping public login and handoff responses limited to `token` and `user`; verify `pnpm --filter server exec vitest run test/auth.test.ts test/oauth.test.ts test/preview-login.test.ts` passes.

## 2. Integrated Verification and Review

- [x] 2.1 Run `pnpm --filter server typecheck`, `pnpm check:specs`, and `git diff --check`, then run the required Feather Code Review and resolve every in-scope finding before recording the change in `PROGRESS.md`.
