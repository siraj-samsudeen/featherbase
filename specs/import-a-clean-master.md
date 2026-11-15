# Build 1: import a clean master

Draft for the owner to correct. Nothing here is built yet.

A person uploads a spreadsheet of clean master data. Featherbase keeps the file, makes a Table from it,
brings the rows in, and lets people browse and edit them. The sample is
`samples/employees/employees-clean.csv` (24 rows, 7 Columns).

## Working choices this build forces

Each is a default to confirm, not a decision.

1. **Stack:** Node, Hono, Postgres through `postgres.js`, React, pnpm, Vitest with `feather-testing-postgres`.
2. **Sign-in:** one built-in administrator. No roles or permissions yet. Every write still records who made it.
3. **Screens:** three plain ones: upload, confirm the Table, list with a form.
4. **Where the Table's definition lives:** in the database, made by the import. Definition files come later.
5. **Tests:** every scenario below is a test that uses only HTTP, as a person's browser would. No test calls
   an internal function. Coverage of the server is 100%, reached by those tests; code they cannot reach is
   deleted.
6. **Carried over from `main` unchanged:** the process files (`AGENTS.md`, skills, OpenSpec config),
   `CONTEXT.md`, and the pure logic that infers Column types and converts cell text
   (`packages/shared/src/import.ts`).
7. **Types in this build:** Text, Number, Date, Yes/No, Choice.
8. **Formats in this build:** dates as `2015-01-01`; yes/no as `true` / `false`; numbers as plain digits with
   an optional decimal point; CSV files in UTF-8. Excel files and other formats come later.

## The journey

This is build 1 as a person lives it. It doubles as the product demo, and it is the first test written: one
run through these steps in a real browser, with the sample file.

**Priya has an employee list in a spreadsheet. Two minutes later it is a working Table.**

1. **Drop the file.** Priya signs in and drops `employees-clean.csv` on the page.
2. **See what Featherbase understood.** A preview appears: a Table called "Employees", 24 rows, seven Columns.
   Featherbase has worked out that joining and leaving dates are Dates, Active is Yes/No, Weekly Hours is a
   Number, and Department is a Choice of five values. It suggests Employee Code as the key.
3. **Confirm.** She changes nothing and presses Create.
4. **Browse.** The Employees list opens with all 24 people.
5. **Open one.** She clicks Asha Raman. A form shows her seven values, and where the row came from:
   `employees-clean.csv`, row 2.
6. **Change one.** She moves Asha from Sales to Billing, choosing from the five departments, and saves. The row
   shows who changed it and when.
7. **The original is safe.** She downloads the uploaded file again; it is exactly what she dropped.

**When the file has a problem.** Priya drops `employees-messy.csv` and presses Create. Nothing is created.
Featherbase lists what is wrong: row 3 has no Employee Code; rows 4 and 5 have the same one. She is told to
fix the file and try again. Cleaning it up inside Featherbase is build 2.

## The checks behind the journey

Each scenario below is one step of the journey, or one refusal, stated exactly so it can be tested.

### The upload is kept
- Given the sample file
- When the administrator uploads it
- Then the same bytes can be downloaded again
- And the upload records the file name, its size, who uploaded it and when

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

### Nothing comes in if a key is blank or repeated
- Given `samples/employees/employees-messy.csv`
- When the person confirms its proposal with Employee Code as the key
- Then no Table is created and no rows come in
- And the answer lists sheet row 3 as a blank key and rows 4 and 5 as the same key

### Nothing comes in if a cell does not fit its Column
- Given a copy of the sample file where one Weekly Hours cell is "forty"
- When the person confirms its proposal
- Then no rows come in
- And the answer names the sheet row, the Column and the value

### People browse the rows
- Given the sample file has been imported
- Then the list shows 24 rows in key order with all seven Columns
- And opening E0007 shows its values in a form

### People edit a row
- Given the sample file has been imported
- When the administrator changes E0007's Department to Billing
- Then the row shows Billing, who changed it and when
- And changing it to a value outside the Choice is refused

### A second Table with the same name is refused
- Given the sample file has been imported as "Employees"
- When the same file is uploaded and confirmed as "Employees" again
- Then it is refused, and the first Table is unchanged

## Not in this build

Excel files; other date and number formats; Issues, corrections and partial imports (build 2); re-import of a
newer version; references between Tables; roles and permissions; history of every change; outside sources;
definition files; apps.
