<!-- The test list, the same in every mode. Outer tests are the fenced Gherkin scenarios in this
     change's specs, run by cucumber-js from acceptance-tests/; the acceptance-tests/ setup
     arrives with 1.1, the first outer test, and each step definition with the first scenario
     that needs it. In autopilot, senior-qa writes the outer tests and senior-dev the inner
     tests and code, down this same list.
     Running example: Section Mapping's ten columns (Section, MCH, Floor, Zone, Rack, Owner,
     Category, Remarks, Updated By, Notes). -->

## 1. An imported Section Mapping lists its first seven columns (@spec A new table's list starts with its first seven columns)

- [x] 1.1 outer: the scenario, importing the ten-column sheet as a new table
- [x] 1.2 inner: `inferTableDef` flags the first 7 columns, using one shared constant of 7
- [x] 1.3 inner: the Import Wizard's column step shows an "In list" tick per column, the first 7 ticked

## 2. A typed table starts the same way (@spec A new table's list starts with its first seven columns)

- [x] 2.1 outer: the scenario, typing the same ten columns in the Table Builder
- [x] 2.2 inner: the Table Builder ticks the first 7 columns, from the same constant

## 3. A column left out of the import makes room for the next (@spec A new table's list starts with its first seven columns)

- [x] 3.1 outer: the scenario, leaving MCH out
- [x] 3.2 inner: until the user changes an "In list" tick, the ticks follow "first 7 columns in use"; after that the user's ticks stand
- [x] 3.3 inner: a column whose "Use" is unticked is never sent as in the list

## 4. All ten in one go (@spec A new table's list starts with its first seven columns)

- [x] 4.1 outer: the scenario
- [x] 4.2 inner: "Tick all" ticks every column in use; "Clear" unticks them all

## 5. Section Mapping shows its seven list columns (@spec A list shows the table's list columns)

- [x] 5.1 outer: the scenario (expected to pass on its first run: today's behaviour)

## 6. A table with no list columns shows its first two (@spec A list shows the table's list columns)

- [x] 6.1 outer: the scenario (expected to pass on its first run: today's fallback)

## 7. Remarks shows only for me (@spec Show or hide any column for yourself)

- [x] 7.1 outer: the scenario
- [x] 7.2 inner: the menu lists the Table's list columns first, then a divider, then every other readable column
- [x] 7.3 inner: what the user sees is Row ID + (list columns ∪ shown) − hidden, in the Table's column order
- [x] 7.4 inner: switching a column on removes it from hidden and, if it isn't a list column, adds it to shown; switching off does the reverse
- [x] 7.5 inner: the `:meta` response carries the caller's readable levels
- [x] 7.6 inner: a `restricted` column is not offered to a caller who may read only `basic`

## 8. Every column off leaves the row ID (@spec Show or hide any column for yourself)

- [x] 8.1 outer: the scenario

## 9. Return after hiding a column (@spec The list remembers how it's arranged)

- [x] 9.1 outer: the scenario (expected to pass on its first run: today's behaviour)
- [x] 9.2 inner: an arrangement saved before this change, `{ hiddenCols: ["floor"] }` with no shown set, still hides Floor and shows every other list column

## 10. Remarks is still there next time (@spec The list remembers how it's arranged)

- [x] 10.1 outer: the scenario
- [x] 10.2 inner: the saved arrangement carries the shown set, and reading it back restores it

## 11. Remarks shows for everyone (@spec Change which columns a table's list shows)

- [ ] 11.1 outer: the scenario, ticking "In list" on the Edit columns page
- [ ] 11.2 inner: the Edit columns page has an "In list" tick per column that saves at once
- [ ] 11.3 inner: the save deletes the `in_list_view` Metadata Override of each column whose flag it changes, inside the same transaction
- [ ] 11.4 inner: it decides "changed" against the stored definition, not the merged meta it was sent
- [ ] 11.5 inner: other overrides, and other columns' `in_list_view` overrides, are untouched

## 12. Only a System Manager changes the list for everyone (@spec Shaping a table requires the builder authority)

- [ ] 12.1 outer: the scenario
- [ ] 12.2 inner: "Make this the default for everyone" shows exactly where "Edit columns" shows
- [ ] 12.3 inner: the definition save refuses a user who isn't a System Manager (expected to pass on its first run: today's check)

## 13. A platform table's columns are closed to editing (@spec Shaping a table requires the builder authority)

- [ ] 13.1 outer: the scenario (expected to pass on its first run: today's behaviour)

## 14. My view becomes the default (@spec A System Manager can make their view everyone's default)

- [ ] 14.1 outer: the scenario
- [ ] 14.2 inner: making the default sends every data column's flag as "in the System Manager's current view", in one save
- [ ] 14.3 inner: after it succeeds, the System Manager's own shown and hidden sets are empty

## 15. A colleague's own choices hold (@spec A System Manager can make their view everyone's default)

- [ ] 15.1 outer: the scenario
- [ ] 15.2 inner: a colleague's shown and hidden sets apply on top of a changed default, both ways

## 16. Read a list of checklist runs on a phone (@spec Lists fit a phone)

- [ ] 16.1 outer: the scenario (expected to pass on its first run: today's behaviour)

## 17. Work with a Table's rows on a phone (@spec Lists fit a phone)

- [ ] 17.1 outer: the scenario

## 18. Section Mapping's cards show three columns and the rest on request (@spec Lists fit a phone)

- [ ] 18.1 outer: the scenario
- [ ] 18.2 inner: a card shows at most 3 listed columns besides title, status and row ID, then "N more"
- [ ] 18.3 inner: "N more" opens that card's other columns in place

## 19. UI checklist items no spec carries (#738 agreed design)

- [ ] 19.1 inner: a dropdown button whose menu is open looks pressed (accent tint, chevron up), from the shared button style; "Show columns" reports open and closed
- [ ] 19.2 inner: the menu's divider reads "Not in the list by default"
- [ ] 19.3 An independent verifier runs the real UI at 1280px and 375px against #738's 11-point checklist and returns a "spec vs built" table with screenshots; differences are fixed before the owner sees the code

## 20. Reconcile

- [ ] 20.1 The full acceptance suite passes with zero pending or undefined steps, and writes its HTML report
- [ ] 20.2 Coverage meets ADR 0012's targets; every uncovered line ratified, deleted or asked
- [ ] 20.3 No unused files, exports or dependencies
- [ ] 20.4 Types check clean
- [ ] 20.5 Mutation testing: every surviving mutant ratified, deleted or asked
- [ ] 20.6 `pnpm exec openspec validate list-columns-from-the-table --type change --strict` passes, then sync the specs and archive the change on this branch before the PR merges
