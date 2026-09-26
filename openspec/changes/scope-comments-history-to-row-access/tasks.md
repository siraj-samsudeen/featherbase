# Tasks

## 1. Pin the authorization contract

- [ ] 1.1 Obtain and record the owner's choice for directly shared sensitive-field history from design decision 4; update the spec delta and remaining direct-share tasks to that choice, then rerun strict OpenSpec validation before writing product code.
- [ ] 1.2 Add failing server regressions for a caller with broad Comment/Version read but access to only one of two parent rows; prove generic list data and total, detail, `:count`, dashboard count/chart and `:aggregate` expose only activity of the readable parent, then run the focused test file and confirm the failures identify the current leak.
- [ ] 1.3 Extend the regressions with asymmetric owner-only, direct Data Scope, reference Data Scope and source-bound parent cases; verify readable activity remains and forbidden activity never changes result values, counts or pagination.
- [ ] 1.4 Add direct-share cases proving document activity works without a Comment/Version Table grant, generic reads still require that grant, and a generic read with the grant includes only the shared parent's activity; assert sensitive Version values exactly as ratified in 1.1 and verify the focused cases fail before implementation.
- [ ] 1.5 Add ordinary role-based Version cases with one basic and one restricted field changed in the same edit; assert full serialized document-activity, generic list and generic detail responses contain the basic old/new values but neither restricted value, and verify the focused cases fail before implementation.

## 2. Enforce parent scope in core reads

- [ ] 2.1 Implement the shared polymorphic activity-target scope for local, Settings and source-bound parents, including owner, Data Scope and activity-only direct-share widening; run the regressions from 1.1-1.3 until list/count/group/aggregate pagination and totals pass.
- [ ] 2.2 Apply the same target authorization to generic Comment/Version detail reads without weakening their Table grant; run the focused direct-detail and direct-share regressions.
- [ ] 2.3 Extract one Version-change sanitizer and apply it to document activity plus generic list/detail results; run the focused restricted-field regressions and `apps/server/test/permlevel.test.ts`.
- [ ] 2.4 Rebase onto current main, preserve #349's exported `scopedWhere`, and prove Comment/Version inherit the new scope. Verify searches for the exact IDs of readable and forbidden activity return only the readable hit without changing #349's general scope.

## 3. Cover indirect reads and realtime

- [ ] 3.1 Add a Report Builder regression over Comment or Version and verify its rows use the same parent scope; confirm trusted Query Report and System Manager team-feed tests remain unchanged and pass.
- [ ] 3.2 Refuse broad non-bypass `list:Comment` and `list:Version` realtime subscriptions and parent-authorize activity row channels; verify focused realtime tests cover an inaccessible target, an accessible target and the System Manager bypass.
- [ ] 3.3 Run the server permission, query, report, search, source-security, realtime, activity-feed and Tasker-action test files plus `pnpm --filter server typecheck`; record the exact commands and results in the implementation handoff.

## 4. Move row UI to the parent-gated response

- [ ] 4.1 Add a shared typed client request/query for document activity, switch Admin Comments and ActivityTimeline to it, and invalidate that query after posting; verify component tests assert one parent-gated request and no generic Comment/Version list request.
- [ ] 4.2 Keep Tasker's filtered bulk Comment list and existing per-task activity request, then run the Tasker component/server/browser tests proving latest stopped-work explanations and task detail discussion/history still render.
- [ ] 4.3 Exercise a readable row with mixed comments and field changes in the browser, inspect the Comments and Activity states, and verify the relevant Admin browser journey passes without any generic activity-list request.

## 5. Integration and handoff

- [ ] 5.1 Run `pnpm check:specs`, server/web/shared typechecks, the focused server and web suites, and `git diff --check`; append the dated verification and next step to `PROGRESS.md` only after all checks pass.
- [ ] 5.2 Review the final read-path inventory against list, detail, count/group/aggregate, Report Builder/auto-email, search, realtime, document activity and the manager feed; verify every ordinary path is either parent-scoped or explicitly privileged before committing the implementation.
