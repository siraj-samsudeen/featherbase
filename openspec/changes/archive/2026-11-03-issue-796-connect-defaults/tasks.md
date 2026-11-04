## 1. First-time setup

Skipped: `acceptance-tests/` exists. Uses #782's outside-database harness and #783's shelves-and-bins steps (merged into this branch).

## 2. Step definitions — each: fails for the right reason → implement → passes → commit

- [x] 2.1 external-data-sources: the shelves fixture gains an aisle before the label and a created-on column (proves the title is the label, not the first value)
- [x] 2.2 external-data-sources: "a shelf labelled … in the … aisle", "the user opens that shelf" and "the user sees the shelf as …"
- [x] 2.3 external-data-sources: "the user opens the list of shelves", "each shelf's label and aisle", "does not see when each shelf was created"
- [x] 2.4 external-data-sources: "only its bin table connected, as …" and "the user may read bins"
- [x] 2.5 external-data-sources: "its shelf's table is not connected yet", "offered to connect the shelf table", "not offered to connect it" (form page object)
- [x] 2.6 external-data-sources: "opens a bin and takes the offer to connect the shelf table" and "the shelf table chosen, ready to connect" (Browse page object)

## 3. Implementation

- [x] 3.1 Reflect sets the title column (first of name, title, label, full_name, display_name, first_name) and the list columns (title + up to four more, in source order, never the key or created/updated/modified/deleted on/at/by columns)
- [x] 3.2 Form: a note beside a column with a recorded source foreign key that is not a link; for a System Manager, a link to the data source's Browse screen with `connect=<schema.table>`
- [x] 3.3 Browse screen: `connect` loads that schema's tables and ticks the table
- [x] 3.4 Server tests (`apps/server/test/sources-postgres-defaults.test.ts`) for the title and list defaults; no test pinned the first-four list default
- [x] 3.5 Web tests for the note, the offer and the Browse preselection (`apps/web/test/source-unlinked-column.test.tsx`)

## 4. Completion

- [x] 4.1 UI verifier: the note and offer, at 1280, against the issue's point 4, with screenshots — 6 of 7 items pass; the link box showing the shelf's id once connected is the platform's link control for every Table, outside this change (PR body)
- [x] 4.2 Acceptance suite: every scenario passes, zero pending or undefined steps — 72 scenarios: 69 passed; "An installed app preserves the platform name" (#806) and the two "running an instance" scenarios (port 5204 held by another worktree's server) failed, as before this change
- [x] 4.3 Server and web tests pass; both apps typecheck; `pnpm check:specs` passes
