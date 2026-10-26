# Tasks

## 1. Variable registry

- [x] 1.1 Add `apps/server/src/env.ts` with every variable the server reads (secret, required, purpose, cross-environment rule) and move all reads into it. Verify: `pnpm --filter server typecheck` and `pnpm test` pass, and `grep -rn "process.env" apps/server/src` finds only `env.ts`.
- [x] 1.2 Add a lint rule banning `process.env` outside `env.ts`. Verify: a test file that reads `process.env` fails lint.
- [x] 1.3 Generate the DEPLOY.md variable table and `.env.example` from the registry, with a CI check that fails when they are stale. Verify: editing a registry entry without regenerating fails the check.

## 2. Release, boot and apply checks

- [x] 2.1 Evaluate the registry in release preflight and at server boot: refuse on a missing required variable, warn on a recommended one, and replace the hand-written `SITE_URL` step. Verify: preflight tests for `SITE_URL` still pass, plus new ones for `JWT_SECRET` (refuse) and `FILE_STORAGE_DIR` (warn).
- [x] 2.2 Support settings-dependent requirements (Google enabled requires `GOOGLE_CLIENT_SECRET`, a manifest source's missing `url_env` warns at release and boot and refuses at the point of use, #482). Verify: a test enabling a Google method without the secret refuses at release.

## 3. Apply, dry run and export

- [ ] 3.1 Declare the managed scope (System Settings fields, sign-in method rows, scheduled-job `enabled`, privacy notice by file). Verify: unit test listing the scope.
- [ ] 3.2 Implement apply (one transaction through `saveDoc`, actor `instance-settings`, source revision in the Activity Log), with dry run, strict validation, and the feature-secret refusal. Verify: tests for changed fields, "nothing changed" on re-apply, unknown field aborts with nothing written, overlay applied per environment.
- [ ] 3.3 Expose apply over HTTP for a System Manager token and as `cli settings:apply --file`. Verify: an HTTP call against the running server with a service-account token returns the changes, and an unprivileged token is refused.
- [ ] 3.4 Implement `cli settings:export`. Verify: export, then apply to the same database, reports "no changes".
- [ ] 3.5 Remove instance settings from manifest fixtures (the System Settings case) and update the sample apps and docs that use it. Verify: `pnpm test`.
- [ ] 3.6 Document the flow in DEPLOY.md: the file, the on-demand apply after a fresh or restored database, and the deploy-failure alert per environment.

## 4. Managed fields locked

- [ ] 4.1 Store the managed paths of the last successful apply, and refuse Admin saves to them from actors other than `instance-settings` and `cli`. Verify: server test where a System Manager's save of a managed field is refused and a `cli settings:set` succeeds and is logged.
- [ ] 4.2 Render managed fields read-only in `FormView` with a note naming the settings file. Verify: Playwright test on the Google sign-in method form.

## 5. Health checks and history

- [ ] 5.1 Add the check functions (System Manager email, recommended variables, settings applied, matches last apply, scheduled job last run, Administrator default password) and print them in the release step. Verify: unit test per check, with failing and passing cases.
- [ ] 5.2 Add the state-change table and a 15-minute scheduled job that records transitions only. Verify: a test that a steady check writes nothing and a flip writes one row.
- [ ] 5.3 Add the Instance health page (state, why, fix, history, link to Activity Log around each change). Verify: Playwright test that opens the page on an instance where the settings were never applied.
- [ ] 5.4 Add the System Manager banner in `AdminLayout`, not dismissable, coloured by worst severity. Verify: Playwright tests that a System Manager sees it and another person does not, and that it disappears once fixed.

## 6. First-run setup

- [ ] 6.1 Offer the setup screen to the built-in Administrator while the email check fails: create System Managers and invite them, show links when email is the sink, and "Not now" reaches the Admin screen. Verify: Playwright test on a fresh database, both with the email sink and with the setup skipped.

## 7. Environment comparison

- [ ] 7.1 Add the variable report with per-call keyed fingerprints for rule-bearing secrets. Verify: test that two calls with different keys give different fingerprints for the same value, and the response contains no value.
- [ ] 7.2 Document the comparison in DEPLOY.md, with the side-by-side table the instance workflow prints.

## 8. Integration

- [ ] 8.1 End to end on a local instance: export, edit, dry run, apply, lock visible in Admin, health page and history update, and fingerprint comparison between two local databases. Verify: the commands and screenshots recorded in the implementation PR.
