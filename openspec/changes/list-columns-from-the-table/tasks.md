<!-- Autopilot (schema intent-driven, spec-as-source): acceptance tests first. The fenced Gherkin
     scenarios in this change's specs are the acceptance tests, run by cucumber-js from
     acceptance-tests/. senior-qa owns groups 1-2, senior-dev owns groups 3-5.
     Running example: Section Mapping's ten columns (Section, MCH, Floor, Zone, Rack, Owner,
     Category, Remarks, Updated By, Notes). -->

## 1. First-time setup — skip this whole section if `acceptance-tests/` already exists

- [ ] 1.1 Confirm the acceptance stack: `stack: javascript` in `openspec/config.yaml`
- [ ] 1.2 Create `acceptance-tests/` at the repo root as an independent Node project that boots the app (the same stack `./init.sh` starts, on its own database) before the suite and shuts it down after
- [ ] 1.3 Copy the acceptance-test-authoring skill's `javascript` reference files verbatim into `acceptance-tests/` (see `references/javascript/SETUP.md` "Files To Copy"), so the runner extracts the Gherkin from every `spec.md` under `openspec/` into `acceptance-tests/.extracted/`, excluding `openspec/changes/archive/`
- [ ] 1.4 Make the single test command always write an HTML report under `acceptance-tests/reports/`
- [ ] 1.5 Add the spec-lint command (extract, then `gherkin-lint .extracted`); gitignore `acceptance-tests/.extracted/` and `acceptance-tests/reports/`
- [ ] 1.6 Write `acceptance-tests/README.md`: how to run the suite and where the report is written
- [ ] 1.7 Wire the acceptance suite into CI beside the e2e job, so a PR runs it

## 2. Step definitions — one task per scenario; each = fails for the right reason → implemented → passes → commit

- [ ] 2.1 tables-and-fields: An imported Section Mapping lists its first seven columns
- [ ] 2.2 tables-and-fields: A typed table starts the same way
- [ ] 2.3 tables-and-fields: A column left out of the import makes room for the next
- [ ] 2.4 tables-and-fields: All ten in one go
- [ ] 2.5 list-view: Section Mapping shows its seven list columns (passes on today's code)
- [ ] 2.6 list-view: A table with no list columns shows its first two (passes on today's code)
- [ ] 2.7 list-view: Remarks shows only for me
- [ ] 2.8 list-view: Every column off leaves the row ID
- [ ] 2.9 list-view: Return after hiding a column (passes on today's code)
- [ ] 2.10 list-view: Remarks is still there next time
- [ ] 2.11 tables-and-fields: Remarks shows for everyone
- [ ] 2.12 tables-and-fields: Only a System Manager changes the list for everyone
- [ ] 2.13 tables-and-fields: A platform table's columns are closed to editing (passes on today's code)
- [ ] 2.14 list-view: My view becomes the default
- [ ] 2.15 list-view: A colleague's own choices hold
- [ ] 2.16 usable-on-any-device: Read a list of checklist runs on a phone (passes on today's code)
- [ ] 2.17 usable-on-any-device: Work with a Table's rows on a phone
- [ ] 2.18 usable-on-any-device: Section Mapping's cards show three columns and the rest on request

## 3. Implementation — each item test-first (unit or e2e), driven by the failing scenarios above

- [ ] 3.1 One shared constant of 7 in `packages/shared`; `inferTableDef` and the Table Builder flag the first 7 columns from it
- [ ] 3.2 Import Wizard column step: an "In list" tick per column; ticks follow "first 7 columns in use" until the user changes one; "Tick all" and "Clear"; a column whose "Use" is unticked is never sent as in the list
- [ ] 3.3 `:meta` response carries the caller's readable levels (`permittedTiers`)
- [ ] 3.4 Saved arrangement gains a shown set: what the user sees is Row ID + (list columns ∪ shown) − hidden, in the Table's column order; switching on/off keeps both sets minimal
- [ ] 3.5 Hidden-logic pin: an arrangement saved before this change, `{ hiddenCols: ["floor"] }` with no shown set, still hides Floor and shows every other list column
- [ ] 3.6 "Show columns" menu: list columns first, the divider "Not in the list by default", then every other readable column; a `restricted` column is never offered to a `basic`-only reader
- [ ] 3.7 Edit columns page: an "In list" tick per column, saved at once through `PUT /api/table_def/:name`
- [ ] 3.8 `updateTable` deletes the `in_list_view` Metadata Override of each column whose flag the request changes, judged against the stored definition, inside the same transaction; other overrides untouched
- [ ] 3.9 "Make this the default for everyone", shown exactly where "Edit columns" is: one save setting every data column's flag to the current view, then the System Manager's own sets emptied
- [ ] 3.10 Phone cards (`DataCards`): at most 3 listed columns besides title, status and row ID, then "N more", which opens the rest in place
- [ ] 3.11 Shared button style: an open dropdown (`aria-expanded="true"`) looks pressed, accent tint and chevron up; "Show columns" reports open and closed

## 4. UI verification

- [ ] 4.1 An independent verifier runs the real UI at 1280px and 375px against #738's 11-point checklist and returns a "spec vs built" table with screenshots; differences are fixed before the owner sees the code

## 5. Completion

- [ ] 5.1 Run the full acceptance suite: every scenario passes, zero pending or undefined steps, HTML report generated
- [ ] 5.2 Unit, e2e and coverage (ADR 0012 targets) pass; types check clean
- [ ] 5.3 `pnpm exec openspec validate list-columns-from-the-table --type change --strict` passes before archive
