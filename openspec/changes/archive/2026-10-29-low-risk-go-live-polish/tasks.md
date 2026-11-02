# Tasks

## 1. Test-only safeguards

- [x] 1.1 Replace #618's assumed first-fetch delay with an explicit start signal in dataset-snapshot.test.ts; retain independent-session exclusion and active-snapshot assertions, release gates on failure, and verify the targeted test repeatedly plus a deliberately broken exclusion control.

## 2. Names and history

- [x] 2.1 Record the #552/#590/#644 UI checklist from design.md on the issues, add failing regression tests, and verify the selected labels/formats against the existing Shop Floor UI before changing components.
- [x] 2.2 Fix no-access branding (#552) without changing usable Admin branding; run top-bar tests covering both the bar and browser tab, no-access actions, and ordinary Admin controls.
- [x] 2.3 Render JSON history values readably (#590) through the existing formatter boundary; extend activity-timeline tests with asymmetric before/after nested values and confirm long values wrap in a browser.
- [x] 2.4 Resolve person-valued and service-account-valued titles (#644) at existing title boundaries; extend public row-title and web tests to cover recents, sidebar, heading and breadcrumb, with ordinary-title and unreadable-row controls.
- [x] 2.5 Have a separate verifier check group 2 at 1280px and 375px in light/dark, return an issue-checklist table and screenshots, fix mismatches, and inspect the final artifacts before owner review.

## 3. Relationship map and import layout

- [x] 3.1 Record the #593/#592/#579 checklist from design.md on the issues, capture representative existing failures and add regression tests in existing map/import files.
- [x] 3.2 Fix map trail titles and single-layer URL encoding (#593); run relation-map tests and a real hop/back/reload journey, including an unreadable or removed trail target.
- [x] 3.3 Reflow the map at narrow widths (#592) without reducing readable text or losing any link group; verify empty, single-link and multiple-backlink cases at 375px and desktop.
- [x] 3.4 Fix the confirmed import wizard defects (#579), first checking reported sticky-bar overlap at a real scroll position; run existing saved-work/import tests and verify result/revert controls remain reachable. Builder and independent verifier could not reproduce overlap, so sticky positioning is unchanged.
- [x] 3.5 Have a separate verifier check group 3 at 1280px and 375px in light/dark against the checklist; inspect final screenshots and the pointer navigation clip, and rerun the related browser journeys after fixes.

## 4. Saved views and navigation

- [x] 4.1 Record the #522/#546 checklist from design.md on the issues and add failing public-behaviour tests before editing ListView, AdminLayout or Explore.
- [x] 4.2 Add the always-available filtered-list save action (#522) using the existing save path and nudge; run saved-view server/component tests and a browser first-use/save/reload/reopen journey, including cancel and failure states.
- [x] 4.5 Reserve recall slots for distinct frequent destinations (#546 item 4); test a full recent list, overlapping rankings and no frequent candidates, and verify no duplicate or empty section appears.
- [x] 4.6 Open the final Explore pane's rows in Peek (#546 item 5) for mouse and keyboard while retaining narrowing in earlier panes; run Explore component/browser journeys and assert selections survive closing Peek.
- [x] 4.7 Have a separate verifier check group 4 at 1280px and 375px in light/dark and inspect final screenshots and the real-input interaction clip; independently review title changes with feather-code-review and address in-scope blockers.
- [x] 4.8 Explain immediate queueing when a scheduled job is switched on (#584); verify the exact copy in the existing Jobs test and independently in both widths/themes without changing or triggering the scheduler.

## 5. Combined verification and handoff

- [x] 5.1 Run affected server/web/shared suites, both typechecks, design guards, pnpm check:specs and pnpm check:e2e-dsl; rerun app boot/smoke and representative user journeys on the final combined tree.
- [x] 5.2 Verify every in-scope issue's acceptance criteria against the final code and evidence, archive this change and rerun pnpm check:specs. PR delivery and merge remain tracked in the PR and #566, gated on green CI under the owner's authorisation; do not manually deploy.
