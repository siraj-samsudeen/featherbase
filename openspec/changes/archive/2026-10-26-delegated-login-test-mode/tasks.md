# Tasks

- [x] 1.1 Write failing server tests (ID-only sign-in with the provider never called; unlinked, disabled and System Manager still refused; only `trust-any-password` turns it on; `/api/brand` flag), then implement `delegatedTestMode()` in `delegated-login.ts`, the blank-password allowance in `/api/login/delegated`, the `delegated_login_test_mode` brand field and a boot warning; verify `apps/server/test/delegated-login.test.ts`.
- [x] 1.2 Login form: a test-mode notice and no password field when `/api/brand` says so; verify with an RTL test in `apps/web/test/delegated-login.test.tsx` that renders the notice, finds no password field and signs in by ID alone.
- [x] 1.3 Leavers: the data-warehouse rollout passes `--disable-leavers` to the roster sync, so a leaver's account is disabled before anyone can use test mode as them.
