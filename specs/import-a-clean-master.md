# Build 1: import a clean master

Draft for the owner to correct. Nothing here is built yet.

A person uploads a spreadsheet of clean master data. Featherbase keeps the file, makes a Table from it,
brings the rows in, and lets people browse and edit them. The sample is
`samples/employees/employees-clean.csv` (24 rows, 7 Columns).

## Decisions for this build

Taken one at a time with the owner. Only what the journey needs is decided; everything else waits.

| # | Aspect | Decision | Status |
|---|---|---|---|
| — | Runtime and framework | Bun, ElysiaJS, Postgres 18.6 | Decided |
| — | Test runner and harness | `bun test` with `feather-testing-elysia` (v0.1, to be released first) | Decided |
| — | Scope | No sign-in and no record of who changed a row. CSV only, clean files only | Decided |
| — | Types and formats | Text, Number, Date, Yes/No, Choice; dates `2015-01-01`, yes/no `true`/`false` | Decided |
| 1 | Database access | Drizzle on Bun's built-in Postgres driver; `postgres.js` if that misbehaves on 18.6, checked at setup | Decided |
| 2 | How a Table and its rows are stored | A plain Postgres table per Table, one real column per Column, readable names (`employees`, `date_of_joining`), in a schema apart from Featherbase's own tables. Featherbase's own columns start with an underscore (`_id`, `_created_at`). `_id` is a time-ordered unique id made by Postgres. Required and unique are real database rules on the key. Number is one exact decimal type | Decided |
| 2a | How raw rows are stored | One shared table for every upload: `_id`, upload, sheet row number (header is 1), cells, and the pair "written to" (the Table and the row's `_id`), empty until imported. Cells are one JSON column: the values only, as text, in sheet order. Header names are stored once on the upload. A database view pairs each value with its header name by position, so a raw row reads as a list of `{name, value}`. One raw row per upload and row number, enforced by the database. Cells are never edited. Blank rows are stored. Rows are loaded in bulk. Measured on 16-Nov-2026 (Bun 1.4.4, local Postgres 16), 100,000 rows of 30 columns: values only takes 39 MB and loads in 2.6 s; name and value in every cell takes 158 MB and loads in 5.0 s; the CSV itself is 22 MB. Postgres compression gave no saving. Later levers, not in this build: drop raw rows of superseded uploads (they can be re-read from the kept file); a size limit per upload | Decided |
| 2b | How a Choice is stored | The row holds the word (`department = 'Sales'`). One shared table holds every list: Column, value, position, retired; a value appears once per Column. The import fills the list from the sheet's distinct values in alphabetical order; the form reads it; a save outside it is refused. A Column is proposed as a Choice only if it is text, is not the key, and its values repeat with at most 10 distinct ones; the person can overrule. Matching is exact; blank is allowed unless the Column is required | Decided |
| 3 | Migrations for Featherbase's own tables | | Open |
| 4 | Where the uploaded file is kept | | Open |
| 5 | Reading the CSV and working out types | | Open |
| 6 | The API for the journey | | Open |
| 7 | The web side | | Open |
| 8 | Tests and coverage | | Open |
| 9 | Repo layout and tooling | | Open |

The owner's October stack evaluation (`featherbase-stack-evaluation`, phase 4d) built an import feature on
Elysia with Drizzle, Eden, Vite, React, TanStack Query and Router, shadcn/ui and Playwright. Its choices and
its recorded lessons are the starting point for each open row.

## The journey

This is build 1 as a person lives it. It doubles as the product demo, and it is the first test written: one
run through these steps in a real browser, with the sample file.

**Priya has an employee list in a spreadsheet. Two minutes later it is a working Table.**

1. **Drop the file.** Priya opens Featherbase and drops `employees-clean.csv` on the page.
2. **See what Featherbase understood.** A preview appears: a Table called "Employees", 24 rows, seven Columns.
   Featherbase has worked out that joining and leaving dates are Dates, Active is Yes/No, Weekly Hours is a
   Number, and Department is a Choice of five values. It suggests Employee Code as the key.
3. **Confirm.** She changes nothing and presses Create.
4. **Browse.** The Employees list opens with all 24 people.
5. **Open one.** She clicks Asha Raman. A form shows her seven values, and where the row came from:
   `employees-clean.csv`, row 2.
6. **Change one.** She moves Asha from Sales to Billing, choosing from the five departments, and saves. The list
   shows Billing.
7. **The original is safe.** She downloads the uploaded file again; it is exactly what she dropped.

## The checks behind the journey

Each scenario below is one step of the journey, stated exactly so it can be tested.

### The upload is kept
- Given the sample file
- When a person uploads it
- Then the same bytes can be downloaded again
- And the upload records the file name, its size and when it was uploaded

### The raw rows are kept
- When the sample file is uploaded
- Then 24 raw rows are stored, numbered 2 to 25 as in the sheet
- And every cell is stored as the text that was in the file

### A Table is proposed from the file
- When the sample file is uploaded
- Then a Table named "Employees" is proposed with seven Columns in the file's order
- And the proposed types are Text, Text, Choice, Date, Date, Yes/No, Number
- And Department is proposed as a Choice of Accounts, Billing, Sales, Stores, Tailoring
- And Employee Code is proposed as the key, being the first Column that is never blank and never repeats
- And nothing has been created yet

### The person corrects the proposal before importing
- Given the proposal for the sample file
- When the person renames the Table, changes Department to Text and confirms
- Then the Table is created as they set it

### The rows come in with the right types
- When the person confirms the proposal for the sample file
- Then the Table holds 24 rows
- And E0007's Date of Joining is 1 January 2015, its Date of Leaving is empty and Active is yes
- And E0021's Weekly Hours is 37.5

### A row remembers where it came from
- Given the sample file has been imported
- Then each row names the upload and the sheet row it came from

### People browse the rows
- Given the sample file has been imported
- Then the list shows 24 rows in key order with all seven Columns
- And opening E0007 shows its values in a form

### People edit a row
- Given the sample file has been imported
- When a person changes E0007's Department to Billing
- Then the row shows Billing
- And changing it to a value outside the Choice is refused

### A second Table with the same name is refused
- Given the sample file has been imported as "Employees"
- When the same file is uploaded and confirmed as "Employees" again
- Then it is refused, and the first Table is unchanged

## Not in this build

A file with problems: blank or repeated keys, cells that do not fit their Column. Build 1 assumes a clean
file; what happens otherwise is designed in build 2. Excel files; other date and number formats; Issues,
corrections and partial imports (build 2); re-import of a
newer version; references between Tables; signing in, roles and permissions; who changed a row and when, and the history
of every change; outside sources;
definition files; apps.
