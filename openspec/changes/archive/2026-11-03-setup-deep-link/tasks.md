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
- [x] 3.3 Complete central independent verification/review through the manager.
- [x] 3.4 Assess spec sync (no deltas), then archive on this branch before merge; standing owner defaults remove routine media-approval pauses.

## Verification

- Base source `422babb8`: the new public component regression rendered the new-row form, then failed after health resolved: expected `/featherbase/admin/Person/new`, received `/featherbase/admin/setup`.
- Isolated development boot: `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/featherbase_issue844 API_PORT=8440 WEB_PORT=5444 ./init.sh` → server smoke OK, 4 browser smoke tests passed.
- `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/featherbase_issue844_test pnpm --filter web test test/first-run-setup.test.tsx test/instance-health.test.tsx` → 15 passed. Includes absent offer, eligible landing, moved-on delayed readiness and authorization controls.
- `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/featherbase_issue844 E2E_API_PORT=8441 E2E_WEB_PORT=5445 pnpm --filter web e2e e2e/first-run-setup.spec.ts e2e/core-form-responsive.spec.ts` → 7 passed. The real delayed-health regression runs at 375px and 1280px; the original form/attachment journey at 375px and 1440px.
- `pnpm --filter web typecheck`, `pnpm check:specs`, `pnpm check:e2e-dsl`, `pnpm check:sensitive`, `pnpm check:vocabulary`, `git diff --check` passed. No thresholds or retries changed.
- Headless agent-browser with a fine moving pointer, 2x DPR, at desktop and 375px: held real health across a new document; released health, typed into the preserved form, and checked URL/form/setup DOM state. Both clips and 5fps contact sheets inspected. Evidence in the worker thread; no raw authentication trace published.
- Central independent UI verification on `14804512` passed at 1280×900 and 375×900, DPR2, including actual-response delay, offer consumption, absent-offer home/reload, real unsaved typing and eligible fresh-home sign-in. The manager inspected final desktop/narrow screenshots and pointer clips. The narrow run is viewport coverage, not physical touch.
- Ordinary hidden-logic review round 1 reported no L1/L2 findings; its two L3 limitations are recorded in the PR body. The manager cleared the owner-model hold as a decision, not a different-model or Codex certification. No certification is claimed.
- Integrated actual `origin/main` at `c49ab37e` without conflicts. The setup source diff remains unchanged. Integrated-tree boot/smoke passed (4 browser checks), focused component suite passed 15/15, browser setup/responsive journeys passed 7/7, and web typecheck passed. Final exact-head CI is required after publication; earlier green CI applies only to `14804512`.
- Sync assessment: `skip_specs: true`, with no delta paths in OpenSpec status. No main specs need modification. The optional design artifact remains intentionally omitted for this local correction, as recorded in `adr.md`.
- No self-merge, deployment or owner-data operations. The distinct missing-initial-Welcome failure on PR #774 head `d349943f` is diagnostic work only, not a repair included in this change.
