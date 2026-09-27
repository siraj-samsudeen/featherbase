# Tasks

## 1. Pin the authorization contract

- [x] 1.1 Add failing direct-share regressions for a recipient with no Table role: a read share returns ordinary fields but omits a restricted field, and a write share saves ordinary changes while silently dropping a restricted-field change; cover native reads/writes and source-bound reads, then verify the focused cases expose the current elevation.
- [x] 1.2 Add a second share recipient with an explicit restricted tier and verify the same shared row includes the restricted field and accepts its write, proving the share preserves rather than replaces role-granted field tiers.
- [x] 1.3 Add failing server regressions for a caller with broad Comment/Version read but access to only one of two parent rows; prove generic list data and total, detail, `:count`, dashboard count/chart and `:aggregate` expose only activity of the readable parent, then run the focused test file and confirm the failures identify the current leak.
- [x] 1.4 Extend the regressions with asymmetric owner-only, direct Data Scope, reference Data Scope and source-bound parent cases; verify readable activity remains and forbidden activity never changes result values, counts or pagination.
- [x] 1.5 Add direct-share activity cases proving document activity works without a Comment/Version Table grant, generic reads still require that grant, and a generic read with the grant includes only the shared parent's activity; verify a bare share shows ordinary changes but neither old nor new restricted values, while a share recipient with restricted read sees them.
- [x] 1.6 Add ordinary role-based Version cases with one basic and one restricted field changed in the same edit; assert full serialized document-activity, generic list and generic detail responses contain the basic old/new values but neither restricted value, and verify the focused cases fail before implementation.

## 2. Enforce parent scope in core reads

- [x] 2.1 Make direct read/write shares grant baseline/basic fields plus only role-granted deeper tiers, without reapplying row-level role/owner/Data Scope checks; run the share field regressions and existing `apps/server/test/docshare.test.ts` and source-security tests.
- [x] 2.2 Implement the shared polymorphic activity-target scope for local, Settings and source-bound parents, including owner, Data Scope and activity-only direct-share widening; run the regressions from 1.3-1.5 until list/count/group/aggregate pagination and totals pass.
- [x] 2.3 Apply the same target authorization to generic Comment/Version detail reads without weakening their Table grant; run the focused direct-detail and direct-share regressions.
- [x] 2.4 Extract one Version-change sanitizer and apply it to document activity plus generic list/detail results, deriving visible fields from the tier-filtered parent even when shared; run the focused restricted-field regressions and `apps/server/test/permlevel.test.ts`.
- [x] 2.5 Preserve #349's exported `scopedWhere` and prove Comment/Version inherit the new scope. Verify searches for the exact IDs of readable and forbidden activity return only the readable hit without changing #349's general scope.

## 3. Cover indirect reads and realtime

- [x] 3.1 Add a Report Builder regression over Comment or Version and verify its rows use the same parent scope; confirm trusted Query Report and System Manager team-feed tests remain unchanged and pass.
- [x] 3.2 Refuse broad non-bypass `list:Comment` and `list:Version` realtime subscriptions and parent-authorize activity row channels; verify focused realtime tests cover an inaccessible target, an accessible target and the System Manager bypass.
- [x] 3.3 Run the server permission, query, report, search, source-security, realtime, activity-feed and Tasker-action test files plus `pnpm --filter server typecheck`; record the exact commands and results in the implementation handoff.

## 4. Move row UI to the parent-gated response

- [x] 4.1 Add a shared typed client request/query for document activity, switch Admin Comments and ActivityTimeline to it, and invalidate that query after posting; verify component tests assert one parent-gated request and no generic Comment/Version list request.
- [x] 4.2 Keep Tasker's filtered bulk Comment list and existing per-task activity request, then run the Tasker component/server/browser tests proving latest stopped-work explanations and task detail discussion/history still render.
- [x] 4.3 Exercise a readable row with mixed comments and field changes in the browser, inspect the Comments and Activity states, and verify the relevant Admin browser journey passes without any generic activity-list request.

## 5. Integration and handoff

- [x] 5.1 Run `pnpm check:specs`, server/web/shared typechecks, the focused server and web suites, and `git diff --check`; append the dated verification and next step to `PROGRESS.md` only after all checks pass.
- [x] 5.2 Review the final read-path inventory against list, detail, count/group/aggregate, Report Builder/auto-email, search, realtime, document activity and the manager feed; verify every ordinary path is either parent-scoped or explicitly privileged before committing the implementation.
