## 1. First-time setup

Skipped: `acceptance-tests/` exists. Uses #782's outside-database harness and #783's shelves-and-bins steps (merged into this branch).

## 2. Step definitions — each: fails for the right reason → implement → passes → commit

- [ ] 2.1 external-data-sources: the shelves fixture gains an aisle before the label and a created-on column (proves the title is the label, not the first value)
- [ ] 2.2 external-data-sources: "a shelf labelled … in the … aisle", "the user opens that shelf" and "the user sees the shelf as …"
- [ ] 2.3 external-data-sources: "the user opens the list of shelves", "each shelf's label and aisle", "does not see when each shelf was created"
- [ ] 2.4 external-data-sources: "only its bin table connected, as …" and "the user may read bins"
- [ ] 2.5 external-data-sources: "its shelf's table is not connected yet", "offered to connect the shelf table", "not offered to connect it" (form page object)
- [ ] 2.6 external-data-sources: "opens a bin and takes the offer to connect the shelf table" and "the shelf table chosen, ready to connect" (Browse page object)

## 3. Implementation

- [ ] 3.1 Reflect sets the title column (first of name, title, label, full_name, display_name, first_name) and the list columns (title + up to four more, in source order, never the key or created/updated/modified/deleted on/at/by columns)
- [ ] 3.2 Form: a note beside a column with a recorded source foreign key that is not a link; for a System Manager, a link to the data source's Browse screen with `connect=<schema.table>`
- [ ] 3.3 Browse screen: `connect` loads that schema's tables and ticks the table
- [ ] 3.4 Server tests (`apps/server/test/sources-postgres-names.test.ts` or a sibling) for the title and list defaults; tests that pinned the first-four list default updated
- [ ] 3.5 Web tests for the note, the offer and the Browse preselection

## 4. Completion

- [ ] 4.1 UI verifier: the note and offer, at 1280, against the issue's point 4, with screenshots
- [ ] 4.2 Acceptance suite: every scenario passes, zero pending or undefined steps
- [ ] 4.3 Server and web tests pass; both apps typecheck; `pnpm check:specs` passes
