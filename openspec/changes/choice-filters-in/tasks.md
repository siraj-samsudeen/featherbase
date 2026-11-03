Each test below is hand-written and built one at a time: red, green and refactor as separate commits.
"S1" to "S15" are the 15 scenarios in this change's specs.

## 1. Add filter ticks choices

Test file: `apps/web/test/choice-filters-in.test.tsx`, against the real in-process server.

- [ ] 1.1 S2: `Adding a filter on Status offers its choices to tick, and only in`
- [ ] 1.2 S7: `Ticking Ground and First Floor shows both floors' rows, with one chip naming both`
- [ ] 1.3 S3: `Floor in Ground and First Floor plus Status Open shows only Open rows on those floors`
- [ ] 1.4 Test: `Add stays off until at least one choice is ticked`
- [ ] 1.5 Test: `Yes/No columns keep = and !=, and text columns keep every operator`

## 2. One filter per Choice column

Same test file.

- [ ] 2.1 S8: `Adding Floor again opens with Ground ticked, and First Floor joins the same chip`
- [ ] 2.2 S9: `An older link or saved view with floor = Ground takes First Floor into one chip`
- [ ] 2.3 S10: `A link with two Floor filters opens as one chip, the address holds one filter, and the quick filter shows both ticked`
- [ ] 2.4 Test: `Filters on different columns, on text columns and on Yes/No columns are never merged`

## 3. The quick filter is the same filter

Same test file.

- [ ] 3.1 S4: `Ticking Closed in the Status box narrows the rows, and unticking it brings them all back`
- [ ] 3.2 S11: `A filter added on Floor with Ground and First Floor shows both ticked in the Floor box`
- [ ] 3.3 S12: `Unticking First Floor in the box leaves only Ground rows, and the chip names only Ground`
- [ ] 3.4 S13: `Ticking every floor in the box removes the Floor filter, and every row shows`
- [ ] 3.5 Test: `The box reads All with no filter, and "2 selected" with two choices ticked`

## 4. Long lists of choices

Same test file.

- [ ] 4.1 S14: `Ticking every floor at once, then unticking Ground, shows every row not on Ground`
- [ ] 4.2 Test: `Clear unticks every choice and removes the filter`
- [ ] 4.3 S15: `Searching Section's 12 choices for "rack", then ticking every one found, ticks only the rack sections`
- [ ] 4.4 Test: `A list of 8 choices has no search box, and a list of 9 has one`
- [ ] 4.5 Test: `Ticks hidden by a search stay on`

## 5. Tests from #742 that change

- [ ] 5.1 Update the tests that expect `=` and `!=` or a single dropdown for Choice
      (`quick-filters.test.tsx`, `list-view.test.tsx`, `e2e/quick-filters.spec.ts`, `e2e/saved-report.spec.ts`)
      so they tick with `in`, keeping what they check
- [ ] 5.2 S1, S5 and S6 keep passing unchanged (text and Yes/No boxes, add and remove a filter)

## 6. A hand-made in with numbers

- [ ] 6.1 Check what a hand-made `["floor","in",[1,2,3]]` does today on a normal Table and on a bound one, and report
      it to the owner before deciding anything (a discovered behaviour is the owner's call)

## 7. Browser journey

Test file: `apps/web/e2e/choice-filters-in.spec.ts`, headless.

- [ ] 7.1 `Ticking two floors in Add filter, then a third in the quick filter, shows all three floors in one chip`

## 8. UI checklist, confirmed by the separate verifier

- [ ] 8.1–8.16 Issue #820's points 1–16, one line each
- [ ] 8.17 Run the separate UI verifier headless against the real app at 1280px on the points above; save a
      "spec vs built" table and screenshots
- [ ] 8.18 Fix what it finds, and rerun its failed points

## 9. Final checks

- [ ] 9.1 `pnpm --filter web test` and `pnpm --filter server test` pass
- [ ] 9.2 `pnpm --filter web typecheck` passes
- [ ] 9.3 `pnpm --filter web e2e` passes, or is reported as not run if Playwright still doesn't start on this Windows
      machine
- [ ] 9.4 `pnpm dev jeyarama/dash` boots, and the Section Mapping list works in a headless browser
- [ ] 9.5 `pnpm exec openspec validate choice-filters-in --strict` and `pnpm check:specs` pass before archive
- [ ] 9.6 PR body: what was done, the commands that verify it, how to try it, and under "Deliberately not handled":
      `not in` for Choice, months for dates, OR between different columns
