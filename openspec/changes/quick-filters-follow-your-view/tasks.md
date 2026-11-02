Each test below is hand-written and built one at a time: show it, get the owner's prediction, then red, green and
refactor as separate commits. "S1" to "S16" are the 16 scenarios in this change's specs.

## 1. The server reads a Yes/No filter value (both kinds of Table)

Test file: `apps/server/test/filter-yes-no.test.ts`, with the connected-Table tests beside the source they need.

- [x] 1.1 S11 test on a normal Table: `A link saying Active is "true" finds the active rows`
- [x] 1.2 Test on a normal Table: `true, false, yes and no find the right rows in any capitals, with = and !=`
- [x] 1.3 S12 test on a normal Table: `A link saying Active is "maybe" finds no rows, with = and with !=`
- [x] 1.4 Test on a normal Table: `A real true, a real false and an empty value still work`, so existing callers keep working
- [x] 1.5 Test on a Table connected to Postgres: `A connected Table reads Yes/No values as a normal Table does`, including "maybe"
- [x] 1.6 Test on a Table connected to local DuckDB: `A warehouse Table finds its rows for Yes and no rows for "maybe"`, with no raw conversion error
- [x] 1.7 CSV folder: no test, because it reflects every column as text and so never holds a Yes/No column (noted in the test file)
- [x] 1.8 Build the one shared Yes/No check, used by `compileFilter` and `mapFilters`, as those tests demand
- [x] 1.9 Test: `The Yes/No check covers only = and !=; the other operators behave as they did`

## 2. The boxes follow the columns a person sees

Test file: `apps/web/test/quick-filters.test.tsx`, against the real in-process server.

- [x] 2.1 S4: `Remarks gets a quick filter when it is switched on, in its place among the columns`
- [x] 2.2 S5: `Floor's quick filter goes when Floor is switched off`
- [x] 2.3 S6: `A filter on a hidden column stays on, shows as in use, and can be removed`
- [x] 2.4 S7: `A date column has no quick filter, and can still get an added filter`
- [x] 2.5 Test: `Number, money, long text, file and JSON columns get no box`
- [x] 2.6 Test: `Row ID gets no box and takes none of the six places, and can still get an added filter`
- [x] 2.7 Drop `Email` and `Small Text` from `STANDARD_TEXT_TYPES`, the types Featherbase no longer has

## 3. Each box suits its column

Same test file.

- [x] 3.1 S3: `Picking Closed narrows the rows and shows as in use; picking All brings them back`
- [x] 3.2 S8: `Typing "asha" in the Owner box finds rows containing asha`
- [x] 3.3 S9: `The Active box offers All, Yes and No, and each finds the right rows`
- [x] 3.4 Test: `A Yes/No box stores the word Yes or No in the page address, as Choice does`

## 4. Add filter offers dropdowns

Same test file.

- [x] 4.1 S1: `Adding Status = Open narrows the rows, and removing it brings them all back`
- [x] 4.2 S2: `Adding a filter on Status offers its choices, without typing`
- [x] 4.3 S10: `An added filter on Active finds the active rows, and its chip reads Yes`
- [x] 4.4 Test: `Choice and Yes/No columns offer only = and !=`, and moving to one from another operator resets it to =
- [x] 4.5 Test: `A text column keeps its typed value and every operator`
- [x] 4.6 Test: the saved report's filter bar, which shares this control, also offers the dropdowns
- [x] 4.7 Update the existing tests that type a Choice value into Add filter (`list-view.test.tsx`, `saved-report.spec.ts`) to pick it instead, keeping what they expect

## 5. Many boxes stay out of the way

Same test file.

- [x] 5.1 S13: `Eight possible boxes show six and say 2 more, and asking shows all eight without leaving the list`
- [x] 5.2 S14: `A link with a value in the eighth box shows six plus the eighth, and says 1 more`
- [x] 5.3 Test: `Six or fewer possible boxes show no "more" control`
- [x] 5.4 Test: `After opening, "Show fewer" folds the extra boxes away again, keeping a box that holds a value` (owner's addition)

## 6. Filters fold away on a phone

- [x] 6.1 S16, component test: `The folded control says 2 filters are in use`
- [x] 6.2 Component test: `Opening the filters shows up to six quick filters, says how many more, and lets the user add one` (changed by the owner on 02-Nov-2026: was every quick filter)
- [x] 6.3 Component test: `While folded only the count shows; opening the filters shows the filters in use, each removable`
- [ ] 6.4 S15, browser test in 7.7: `The rows come straight after the folded filters on a phone`
- [x] 6.5 Component test: `On a phone, Recent folds behind the Filters button; Save view stays showing` (owner's addition)
- [x] 6.6 Component test: `The Filters button shows an arrow that turns over when opened` (owner's addition)
- [ ] 6.7 Add filter's column, operator and value sit on one line on a phone; checked in the browser by 7.7 (owner's addition)

## 7. Browser journeys

Test file: `apps/web/e2e/quick-filters.spec.ts`, headless, using the DSL fixtures. Each journey arrives by clicking, except
the deliberate link tests in 7.5 and 7.6.

- [ ] 7.1 `Switching a column on and off makes its box appear and go`
- [ ] 7.2 `Filtering a column and hiding it keeps the filter on`
- [ ] 7.3 `Picking a Choice in Add filter from its dropdown narrows the rows`
- [ ] 7.4 `Picking Yes in the Active box and in Add filter shows the right rows`
- [ ] 7.5 `A hand-edited link saying "true" shows the active rows, and one saying "maybe" shows none`
- [ ] 7.6 `Eight possible boxes show six plus "+2 more", and a box in use stays showing`
- [ ] 7.7 `On a phone the filters fold with a count, open stacked, and the rows come straight after them`

## 8. UI checklist, confirmed by the separate verifier

Issue #742's points:

- [ ] 8.1 Every column in the person's own view gets a box, if its type can take one; no separate setting
- [ ] 8.2 Switching a column off in Show columns removes its box; switching one on adds it
- [ ] 8.3 The boxes are in the same order as the list's columns
- [ ] 8.4 Text and link columns get a "contains" text box
- [ ] 8.5 Choice columns get a dropdown of their choices, with All
- [ ] 8.6 Yes/No columns get a dropdown of All, Yes and No
- [ ] 8.7 Dates, numbers, money, long text, files and JSON get no box, and stay reachable through Add filter
- [ ] 8.8 At 1280: one row of up to 6 boxes, then "+N more", which opens the rest in place
- [ ] 8.9 At 375: every box sits behind one Filters button showing the number in use; tapping opens them stacked; the rows start right under the toolbar
- [ ] 8.10 A filter holding a value never folds away: it stays in the row at 1280, and the count includes it at 375
- [ ] 8.11 Quick filters and Add filter share the filters in the page address, so a quick filter shows as a chip and a shared link keeps it

The owner's additions:

- [ ] 8.12 Add filter offers a dropdown for Choice columns, with only `=` and `!=`
- [ ] 8.13 Add filter offers a dropdown for Yes/No columns, with only `=` and `!=`
- [ ] 8.14 Yes/No stores the word "Yes" or "No" in the page address, like Choice
- [ ] 8.14a After "+N more" opens the rest, a "Show fewer" button folds them away again; a box holding a value stays
- [ ] 8.14b At 375, opening Filters shows up to 6 boxes stacked, then "+N more" and "Show fewer", as on desktop
- [ ] 8.14c At 375, Recent folds behind the Filters button; Save view stays showing
- [ ] 8.14d At 375, Add filter's column, operator, value and button sit on one line
- [ ] 8.14e The Filters button shows a dropdown arrow that turns over when opened

Verification:

- [ ] 8.15 Run the separate UI verifier against the real app at 1280px and 375px, headless, on the points above; save a "spec vs built" table and screenshots
- [ ] 8.16 Fix what it finds, and rerun its failed points

## 9. Final checks

- [ ] 9.1 `pnpm --filter server test` and `pnpm --filter web test` pass
- [ ] 9.2 `pnpm --filter web e2e` and `pnpm check:e2e-dsl` pass
- [ ] 9.3 `pnpm --filter server typecheck` and `pnpm --filter web typecheck` pass
- [ ] 9.4 `pnpm test:coverage` reports 100% backend coverage including branches (ADR 0016); say what a run without MySQL leaves out
- [ ] 9.5 Local code review of the server logic (the `feather-code-review` skill), findings triaged by `AGENTS.md`, at most 3 rounds
- [ ] 9.6 `pnpm dev jeyarama/dash` boots, and the Section Mapping list works in a headless browser
- [ ] 9.7 `pnpm exec openspec validate quick-filters-follow-your-view --type change --strict` and `pnpm check:specs` pass before archive
- [ ] 9.8 Report as not verified: real MotherDuck (no token here), and MySQL unless `MYSQL_TEST_URL` is available
- [ ] 9.9 Prepare the PR body: the Add filter dropdowns are intentional and the owner's addition; the independent spec review was skipped because the owner reviewed the specs; other operators on a Yes/No column in a hand-changed link are deliberately not handled; the commands that verify it; how to try it
