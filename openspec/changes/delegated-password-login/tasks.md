# Tasks

## 1. Configuration

- [x] 1.1 Add `delegated_login_label`, `delegated_login_url` and `delegated_login_user_column` to System Settings with a migration in the `0070` pattern and to `SystemSettings`; add `delegatedLoginConfig()` (blank URL/column → off, non-https except localhost → off, blank label → host); verify with focused tests in `apps/server/test/delegated-login.test.ts`.
- [x] 1.2 Expose `delegated_login_label` (null when off) on public `GET /api/brand`; verify with a test that the field is null by default and the label when configured.

## 2. Server sign-in route

- [x] 2.1 Write failing tests first for `POST /api/login/delegated`: verified + linked → 200 with `sid` cookie, token, user and landing; provider 401 → 401 with password login's message and no cookie; provider 500, thrown fetch and timeout → 503 naming the label; unlinked → 403; disabled → 401; two linked → 409; off → 404 with the provider never called; bad column → 503 with the provider never called; password in no log line or response; per-credential rate limit → 429.
- [x] 2.2 Implement `src/delegated-login.ts` (injectable fetch via `_setDelegatedFetch`, outcome classification, safe column check, binding) and the route in `src/index.ts`, plus `ServiceUnavailableError` (503); verify `pnpm --filter server exec vitest run test/delegated-login.test.ts test/auth.test.ts test/pre-auth-rate-limit.test.ts test/settings.test.ts` passes.

## 3. Web sign-in form

- [x] 3.1 Add `loginDelegated()` to `apps/web/src/lib/api.ts` and the second sign-in form to `Login.tsx` (shown only when `/api/brand` names a label, `.fc-*` classes, shared post-sign-in path); verify with an RTL test in `apps/web/test/delegated-login.test.tsx` covering hidden-when-off, success landing, and the three distinct error messages.

## 4. Docs and integrated verification

- [x] 4.1 Document turning it on for StyleHR in `docs/DEPLOY.md` (settings values and the `stylehr_username` Custom Field on User) and add a dated `PROGRESS.md` entry.
- [x] 4.2 Run `pnpm --filter server typecheck`, `pnpm --filter web typecheck`, the full server suite against an isolated database, `pnpm check:specs` and `git diff --check`.
