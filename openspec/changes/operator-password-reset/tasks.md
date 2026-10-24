# Tasks

## 1. Break-glass reset

- [x] 1.1 Add failing CLI tests: the password is read from standard input, the old one is refused, earlier sessions end, and the Activity Log records the actor; refusals for a password on the command line, a missing standard-input flag, a short password, an unknown person and a service account.
- [x] 1.2 Add the command over the shared password write, with the session cut-off and the Activity Log entry; verify the CLI tests pass.
- [x] 1.3 Compare the cut-off in whole seconds; test that a sign-in after the reset, another person's session and the person's access token all keep working.
- [x] 1.4 Revoke outstanding reset links in the same transaction, and make the emailed reset re-check the cut-off under the person's row lock; test a link issued before the reset is refused.

## 2. Docs and verification

- [x] 2.1 Add the "Locked out" runbook to `docs/DEPLOY.md`, including the interactive fallback and how to revoke access tokens.
- [x] 2.2 Run the CLI, auth and password-reset tests, `pnpm --filter server typecheck` and `pnpm check:specs`.
