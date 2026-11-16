# Build 1: import a clean master

Draft for the owner to correct. Nothing here is built yet.

A person uploads a spreadsheet of clean master data. Featherbase keeps the file, makes a Table from it,
brings the rows in, and lets people browse and edit them. The sample is
`samples/employees/employees.csv` (24 rows, 7 Columns).

## Decisions for this build

Taken one at a time with the owner. Only what the journey needs is decided; everything else waits.

| # | Aspect | Decision | Status |
|---|---|---|---|
| — | Runtime and framework | Bun, ElysiaJS, Postgres 18.6 | Decided |
| — | Test runner and harness | `bun test` with `feather-testing-elysia` (v0.1, to be released first) | Decided |
| — | Scope | No sign-in and no record of who changed a row. CSV only, clean files only | Decided |
| — | Types and formats | Text, Number, Date, Yes/No, Choice; dates `2015-01-01`, yes/no `true`/`false` | Decided |
| 1 | Database access | Drizzle on Bun's built-in Postgres driver; `postgres.js` if that misbehaves on 18.6, checked at setup | Decided |
| 2 | How a Table and its rows are stored | A plain Postgres table per Table, one real column per Column, readable names (`employees`, `date_of_joining`). People's Tables go in schema `main` by default; later a person picks the schema, or it is the app's name. Featherbase's own tables go in schema `featherbase`. `featherbase`, `main`, and the names Postgres reserves are refused as app or schema names. Featherbase's own columns start with an underscore (`_id`, `_created_at`). `_id` is a time-ordered unique id made by Postgres. Required and unique are real database rules on the key. Number is one exact decimal type. Every internal link to a Table or Column uses its `_id`, never its name, so a Table can later be renamed or moved to another schema without breaking anything inside | Decided |
| 2a | How raw rows are stored | One shared table for every upload: `_id`, upload, sheet row number (header is 1), cells, and the pair "written to" (the Table and the row's `_id`), empty until imported. Cells are one JSON column: the values only, as text, in sheet order. Header names are stored once on the upload. A database view pairs each value with its header name by position, so a raw row reads as a list of `{name, value}`. One raw row per upload and row number, enforced by the database. Cells are never edited. Blank rows are stored. Rows are loaded in bulk. Measured on 16-Nov-2026 (Bun 1.4.4, local Postgres 16), 100,000 rows of 30 columns: values only takes 39 MB and loads in 2.6 s; name and value in every cell takes 158 MB and loads in 5.0 s; the CSV itself is 22 MB. Postgres compression gave no saving. Later levers, not in this build: drop raw rows of superseded uploads (they can be re-read from the kept file); a size limit per upload | Decided |
| 2b | How a Choice is stored | The row holds the word (`department = 'Sales'`). One shared table holds every list: Column, value, position, retired; a value appears once per Column. The import fills the list from the sheet's distinct values in alphabetical order; the form reads it; a save outside it is refused. A Column is proposed as a Choice only if it is text, is not the key, and at least 90% of its non-blank rows hold a value that another row also holds (decision 5); there is no fixed limit on the number of values; the person can overrule. Matching is exact; blank is allowed unless the Column is required | Decided |
| 3 | Migrations for Featherbase's own tables | Drizzle's migration tool: tables described in code, one generated SQL file per change, file names by timestamp (to confirm at setup), pointed at schema `featherbase` only. Tables people make are created by the app, not by migrations | Decided |
| 4 | Where the uploaded file is kept | In Postgres. The bytes sit in their own table, apart from the upload record, so listing uploads never reads them and the change-data-capture package can skip that table. The record holds a checksum and the size. Limit 50 MB per file to start. Storing and fetching go through one small place in the code | Decided |
| 5 | Reading the CSV and working out types | A well-used CSV library (Papa Parse, to confirm on Bun at setup), returning every cell as text. The file must be comma-separated, UTF-8, headers in the first row. Types are worked out by fresh rules, tried in order on a Column's non-blank cells: every cell `true` or `false` → Yes/No; every cell a plain number (`48`, `37.5`, `-3`) → Number; every cell a real date written `2015-01-01` → Date; it is not the key, and at least 90% of its non-blank rows hold a value that another row also holds → Choice (no fixed limit on the number of values; a few one-off values are tolerated); otherwise Text. A blank cell is empty; an all-blank Column is Text. Spaces at the ends of a cell are ignored. Every row is examined. The key is proposed as the first Column never blank and never repeated. The header is the Column's label as written; its database name is lower case with underscores. The Table's name comes from the file name (`employees.csv` → "Employees"). The person can overrule any of it | Decided |
| 6 | The API for the journey | Plain resource addresses with a checked input and output on every route; the typed client and the API document are generated from them. Calls: send a file; get an upload's proposal; import an upload with the confirmed proposal; get a Table's definition; list a Table's rows (a page in key order, plus the total); get one row with the upload and sheet row it came from; update one row; download an upload's file. The proposal is not stored: it is worked out from the raw rows when asked. The import is one transaction and runs while the person waits. Every value travels as text: dates `2015-01-01`, numbers `"37.5"`, yes/no `"true"` / `"false"`; blank is empty. In the database they are typed (date, exact decimal, boolean). The typed client's automatic date conversion is switched off. A Table is named in a call by its `_id`. Every failure has one shape, a status and a readable message; no database text leaks. Not in this build: sign-in checks, filters and sort choices, a guard against two people editing one row | Decided |
| 7 | The web side | Pages are rendered by the server as HTML, with forms and native controls. htmx updates part of a page without a reload. A small script is allowed for one named interaction HTML cannot do (the file drop zone). React is used only where a screen really requires it, decided and recorded each time. The API (decision 6) is built from the start, not deferred, and an MCP endpoint sits over it as a thin layer, because the owner works with Featherbase through Claude Code. The old `shop-floor` kit is not carried over: the owner judges it unpolished (scrolling bugs in the list, components and layouts that do not fit together) | Decided |
| 7a | The look and layout of the generic screens | `design/list-and-form.html` is the design. It is a working HTML mock-up with made-up rows, chosen by the owner, and the build uses its markup and styles as they are, replacing the sample rows with real data. No separate specification of tokens or components is written: the owner found that premature specification is what spoiled the old kit. The mock-up is improved by editing the HTML itself. It covers the list and one form for new, edit and delete. How a record opens (side panel or full page) and the row height (comfortable or compact) are each person's preference, switchable at any time; both layouts are kept. With no sign-in in this build the preference is remembered in the browser; it becomes a per-person setting when people sign in. Search, sort and filter come later | Decided |
| 8 | Tests and coverage | Agreed in principle. Two kinds of test and no others. **Journeys**: what the owner would show in a demo, as numbered steps in his words; each runs in a real browser with a real file on a fresh install (empty database, migrate, start); few, and only the owner adds one; every run records a video. **Behaviours**: one rule each, in one everyday sentence, tested at the boundary. The owner approves sentences, not tests: a check enforces one test per sentence and no test without one. Examples live in this spec as tables and the tests run them from here, so an expectation cannot change without this file changing. MECE is measured by a tool that breaks the code on purpose: every break must be caught by some test (exhaustive), and every test must catch a break no other test catches (exclusive). Done means a recorded journey passing on a fresh install, not an agent's word; a second agent audits occasionally, not on every change. Still to settle: the tool and its speed on Bun, and where each check runs | Agreed in principle |
| 9 | Repo layout and tooling | | Open |

The owner's October stack evaluation (`featherbase-stack-evaluation`, phase 4d) built an import feature on
Elysia with Drizzle, Eden, Vite, React, TanStack Query and Router, shadcn/ui and Playwright. Its choices and
its recorded lessons are the starting point for each open row.

## Agreed for later, not in this build

- **Regrouping is free.** A module is a label on a Table for menus and lists; changing it touches nothing in
  Postgres.
- **Moving a Table between `main` and an app, or renaming a schema, is one deliberate step** in one
  transaction. Postgres moves a table to another schema without copying data.
- **A name history** records every move and rename (this Table was `main.employees` until this date, then
  `hr.employees`). It travels to MotherDuck through the change-data-capture package so the pipeline can follow
  a Table across a rename and rewrite itself. Old addresses are answered from it.
- **A preview before a move**, and a refusal when the new name is already taken.
- **The uploaded file is a safety net for a while, not a permanent record.** Its purpose is protection during
  clean-up: people come back with an older version of a sheet and overwrite the right one (the owner has seen
  this with budgets). After some time the file is not worth carrying. So later: a keep-for period, after which
  the bytes and the raw rows are archived to object storage or removed, while the upload record (name,
  checksum, date) stays. What that safety net needs while the file is kept: undo of an import; recognising a
  file that was uploaded before, by its checksum; and a warning when a re-import would put values back to
  what an earlier upload held.

## The journey

This is build 1 as a person lives it. It doubles as the product demo, and it is the first test written: one
run through these steps in a real browser, with the sample file.

**Priya has an employee list in a spreadsheet. Two minutes later it is a working Table.**

1. **Drop the file.** Priya opens Featherbase and drops `employees.csv` on the page.
2. **See what Featherbase understood.** A preview appears: a Table called "Employees", 24 rows, seven Columns.
   Featherbase has worked out that joining and leaving dates are Dates, Active is Yes/No, Weekly Hours is a
   Number, and Department is a Choice of five values. It suggests Employee Code as the key.
3. **Confirm.** She changes nothing and presses Create.
4. **Browse.** The Employees list opens with all 24 people.
5. **Open one.** She clicks Asha Raman. A form shows her seven values, and where the row came from:
   `employees.csv`, row 2.
6. **Change one.** She moves Asha from Sales to Billing, choosing from the five departments, and saves. The list
   shows Billing.
7. **The original is safe.** She downloads the uploaded file again; it is exactly what she dropped.

## A second journey: Claude Code does the same

1. An agent connects to Featherbase through MCP.
2. It uploads `employees.csv` and reads the proposal.
3. It confirms, and reads back the 24 rows.
4. It moves Asha from Sales to Billing.

## Behaviours

One sentence each, in everyday words. Each sentence has exactly one test, and there is no test without a
sentence. Where a sentence has a table, the test runs the table's rows as written here.

**Uploading**

1. An uploaded file is kept exactly: downloading it gives back the same file.
2. An upload remembers its file name, its size and when it arrived.
3. Every row of the file is kept as it was, with its row number from the sheet.
4. A file over 50 MB is refused.

**Proposing a Table**

5. The Table's name comes from the file name: `employees.csv` gives "Employees".
6. Each header becomes a Column, in the file's order.
7. A Column's type is worked out from its cells.

   | Cells in the Column | Type |
   |---|---|
   | `true`, `false`, `true` | Yes/No |
   | `48`, `37.5`, `-3` | Number |
   | `1`, `0`, `1` | Number |
   | `2015-01-01`, `2024-12-31` | Date |
   | `2015-01-01`, `2021-02-31` | Text |
   | `48`, `forty` | Text |
   | `Asha`, `Bala`, `Chitra` | Text |
   | `Sales`, `Billing`, `Sales`, `Billing` | Choice |

8. A blank cell doesn't count when working out the type. A Column with only blanks is Text.
9. Spaces at the ends of a cell are ignored.
10. The key is proposed as the first Column that is never blank and never repeats.
11. A text Column whose values mostly repeat is proposed as a Choice, with its values in alphabetical order.
    "Mostly" means at least 9 rows in 10 share their value with another row. The key is never a Choice.
12. Nothing is created until the person confirms.

**Confirming**

13. Before confirming, the person can change the Table's name, any Column's type and the key.
14. Confirming creates the Table and brings in every row.
15. Each value is stored as its Column's type.

    | Type | In the file | Stored as |
    |---|---|---|
    | Number | `37.5` | 37.5, exactly |
    | Date | `2015-01-01` | 1 January 2015 |
    | Yes/No | `true` | yes |
    | Choice | `Sales` | Sales |
    | any | blank | empty |

16. Each row remembers the upload and the sheet row it came from.
17. A Table name already in use is refused, and nothing is created.

**Browsing**

18. The list shows the rows in key order, 50 at a time, and says how many there are in all.
19. Opening a row shows all its values and where it came from.
20. Dates are shown as 01-Jan-2015.

**Changing**

21. A person can change a row's values and save them.
22. A value that isn't in a Choice's list is refused.
23. A value that doesn't fit its Column's type is refused, and the message names the Column.
24. The key can't be blank, or the same as another row's.
25. A person can add a row. It says it was added by hand.
26. A person can delete a row, after confirming.

**Preferences**

27. A person chooses how a record opens, side panel or full page, and the choice is remembered.
28. A person chooses the row height, comfortable or compact, and the choice is remembered.

**Refusals**

29. Every refusal says what was wrong in words a person can act on.

## Not in this build

A file with problems: blank or repeated keys, cells that do not fit their Column. Build 1 assumes a clean
file; what happens otherwise is designed in build 2. Excel files; other date and number formats; Issues,
corrections and partial imports (build 2); re-import of a
newer version; references between Tables; signing in, roles and permissions; who changed a row and when, and the history
of every change; outside sources;
definition files; apps.
