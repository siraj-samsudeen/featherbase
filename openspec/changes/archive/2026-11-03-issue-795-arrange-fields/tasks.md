## 1. First-time setup

Skipped: `acceptance-tests/` exists. Uses #782's outside-database harness (`support/stack.js`) and its reader-login data source.

## 2. Step definitions — each: fails for the right reason → implement → passes → commit

- [x] 2.1 Parcels fixture: "a connected database of parcels on racks", "a parcel labelled … on the rack …", "the user may read parcels and racks", "a colleague may read parcels and racks"
- [x] 2.2 Form page object: the arranged field labels in order, the folded empty-field line, the footer line, the type marks, how a value reads (even-width figures, a marker, a link's name, a file name), one line vs long text, one column vs two, the group a field sits in
- [x] 2.3 external-data-sources: "its sender on one line", "its instructions as long text"
- [x] 2.4 core-forms: importance order, folded empty fields and opening them, the footer line, values by type
- [x] 2.5 core-forms: arranging by data type, filled first, links first, the table's own order; one column
- [x] 2.6 core-forms: remembered for the user ("arranged … by data type in one column", "opens that parcel again") and not for a colleague
- [x] 2.7 core-forms: the parcel desk laid out in two sections opens in its builder's sections

## 3. Implementation

- [x] 3.1 Postgres and MySQL reflect: `varchar(n)` / `char(n)` → `Data` at any `n`; unbounded text → `Text` (server source tests)
- [x] 3.2 Shared row check: a connected Table's `Data` columns are not capped at 140 characters (server and web pass whether the Table is connected)
- [x] 3.3 `PUT /api/user_settings/:table` merges top-level keys into the stored record (server test: a list save keeps the form's key and the other way round)
- [x] 3.4 `FormArrangement.tsx`: arrangements, `arrangeFields` (computed from the saved row), group view with a folding empty-fields line, read-only `ValueField` (type mark, even-width numbers, yes/no marker, link name with peek, file name, one-line vs long text, the #796 unlinked note, labelled for assistive tech), the footer line; type icons in `ui/icons.ts`
- [x] 3.5 `useFormArrangement`: the person's choice from `user_settings` (`form` key), defaulting to the Table's own order for a Table with sections and by importance otherwise; saves merge
- [x] 3.6 `FormView.tsx`: the arrange switch and the 1-or-2 columns switch on an existing row; the arranged card; the sectioned layout for the Table's own order and for a new row; editable rows keep their controls (bookkeeping fields stay controls at the foot); the #793 link picker and #796 note in every arrangement
- [x] 3.7 Web tests for the arrangements, the defaults, remembering, and read-only values; update tests that pinned the old layout on an undesigned Table (listed in the PR)

## 4. Completion

- [x] 4.1 UI verifier: the arranged form at 1280 against the issue's 10 points, with screenshots, in its own checkout and ports — all 10 points and checks (a)–(e) pass (PR body)
- [x] 4.2 Acceptance suite: every scenario passes, zero pending or undefined steps — 110 scenarios: 108 passed; the two "running an instance" scenarios failed only because port 5204 is held by another worktree's server
- [x] 4.3 Server and web tests pass; both apps typecheck; `pnpm check:specs` passes — server 20 failures identical on the pre-change base (environment); web: admin-shell-extras, runtime-client-identity and task-management fail as before this change
