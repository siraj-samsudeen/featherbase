## 1. Acceptance examples first

- [x] 1.1 Add failing acceptance steps for searching actual library examples and displaying their reuse locations.
- [x] 1.2 Add failing acceptance steps for collection → row → related collection navigation, retaining the original search/section.
- [x] 1.3 Add failing acceptance steps for resetting edits and refusing unsupported synthetic actions without live forwarding.
- [x] 1.4 Add failing acceptance steps for the same native form saving/reloading against an isolated real server.

## 2. Real-component key layout

- [x] 2.1 Implement the smallest Breadcrumbs, SearchableList and ContentTabs contracts needed by the examples, using existing controls/tokens; retain DataList cell renderers for editable examples.
- [x] 2.2 Render the searchable library and full-content key layout; send inspected 1280px evidence/portal to manager before finalizing consequential choices. Coordinate native shell width seam with #800, preserving production defaults.

## 3. Safe starter and retained screen

- [x] 3.1 Add dev-only fixture entry/config with explicit known responses, no live proxy and closed-by-default API/file/websocket handling; verify production build excludes fixture content.
- [x] 3.2 Mount native shell/providers, metadata ListView/FormView and shared non-Table examples. Add populated/empty/loading/error/permission-limited scenario controls and in-memory reset, with simulation labels.
- [x] 3.3 Inventory every potentially long exposed collection and keep its search/breadcrumbs accessible, including editable mapping examples and return navigation. Check the existing long-value DataList specimen by DOM measurements before treating clipping as a defect.
- [x] 3.4 Demonstrate identical screen imports/controls in fixture and real API modes; verify real save/reload and related navigation on this issue's disposable database. Do not implement #772 domain features or #795/#793/#800 behavior.
- [x] 3.5 Add concise launch/import/state/isolation guidance and send #772 the exact reusable export contracts.

## 4. Verification and delivery

- [x] 4.1 Run effective acceptance with zero pending/undefined steps, targeted component checks, typecheck/build, strict OpenSpec validation, repository guards and isolated init/smoke. Preserve coverage gates.
- [ ] 4.2 Run independent headless UI verification at 1280 against the numbered issue checklist. Inspect representative screenshots and real pointer/keyboard interaction recording. Obtain ordinary fixture/config review; no adversarial review without consent.
- [x] 4.3 Commit/push this increment and prepare PR with reproducible evidence, exact-head CI and PR-comment subscriptions; report manager. No merge or deployment. Keep persistent thread open; prepare the archive and finish it after the remaining ordinary-review task is resolved.

Verified original snapshot: effective acceptance 65 scenarios / 460 steps; full web coverage 146 files, 1,412 passed / 2 expected failures, lines 94.23%, statements 93.79%, functions 92.54%; focused checks 6/6; init smoke 4/4. Typecheck/build, strict change validation, repository guards and exact-head CI passed. Independent UI round 2 passed the issue checklist's exercised UI, and final screenshots/interaction clip were inspected.

2026-11-03 07:26 UTC unblock audit: integrated published main c8960192 without conflicts, retaining its command-search behavior and the opt-in wide shell. Reconciled only the published #800 SearchableList placeholder delta from 2c05c89f, not its feature code. Synced the four added requirements into the native-prototype-library main spec unchanged; all 53 main specs validate. Integrated effective acceptance passes 75 scenarios / 526 steps with zero pending/undefined; library/search-bar checks pass 15/15; typecheck/build, repository guards and init smoke 4/4 pass. Inspected current-main shell capture and DOM: 1,040px main canvas, 1,280px page/viewport, no page overflow. Routine media/design parking is removed per owner direction. PR #813 remains draft and task 4.2 remains unchecked for the assigned ordinary read-only reviewer; no review waiver or merge/deploy authorization is inferred. Archive target is 2026-11-03-reusable-native-prototype-library, prepared but not moved with an unfinished review task. This persistent library thread stays open after delivery.
