# Tasks

## 1. Reproduce the existing promise

- [x] 1.1 Boot an isolated worktree from current origin/main with its own database and ports.
- [x] 1.2 Add a public regression and observe the real delayed health response move a valid new-row deep link to setup on unchanged source.

## 2. Restore landing eligibility

- [x] 2.1 Limit the offer to Admin home landings; retain consumption, delayed-readiness and authorization behavior.
- [x] 2.2 Run focused component controls and full-document browser regressions at 375px and desktop, plus the original responsive form journey.

## 3. Publish review evidence

- [x] 3.1 Run typecheck, spec validation and repository guards; inspect a real pointer clip.
- [x] 3.2 Prepare the PR and exact-head subscriptions; ask the manager for central independent verification/review. Do not merge or deploy.
- [ ] 3.3 Complete central independent verification/review through the manager.
- [ ] 3.4 After owner video review, sync/archive on this branch before merge.

## Verification

- Base source `422babb8`: the new public component regression rendered the new-row form, then failed after health resolved: expected `/featherbase/admin/Person/new`, received `/featherbase/admin/setup`.
- Isolated development boot: `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/featherbase_issue844 API_PORT=8440 WEB_PORT=5444 ./init.sh` → server smoke OK, 4 browser smoke tests passed.
- `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/featherbase_issue844_test pnpm --filter web test test/first-run-setup.test.tsx test/instance-health.test.tsx` → 15 passed. Includes absent offer, eligible landing, moved-on delayed readiness and authorization controls.
- `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/featherbase_issue844 E2E_API_PORT=8441 E2E_WEB_PORT=5445 pnpm --filter web e2e e2e/first-run-setup.spec.ts e2e/core-form-responsive.spec.ts` → 7 passed. The real delayed-health regression runs at 375px and 1280px; the original form/attachment journey at 375px and 1440px.
- `pnpm --filter web typecheck`, `pnpm check:specs`, `pnpm check:e2e-dsl`, `pnpm check:sensitive`, `pnpm check:vocabulary`, `git diff --check` passed. No thresholds or retries changed.
- Headless agent-browser with a fine moving pointer, 2x DPR, at desktop and 375px: held real health across a new document; released health, typed into the preserved form, and checked URL/form/setup DOM state. Both clips and 5fps contact sheets inspected. Evidence in the worker thread; no raw authentication trace published.
- Central independent verification/review and owner video review remain outstanding. No self-merge, deployment or owner-data operations.
