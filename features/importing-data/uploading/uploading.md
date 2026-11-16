# Uploading

The scene: a person has a CSV file and gives it to Featherbase.

## Sentences

One sentence per rule, in everyday words. Each sentence has exactly one test, named with the sentence word
for word. Where a sentence has a table, the test runs the table's rows as written here. See `TESTING.md`.

1. An uploaded file is kept exactly: downloading it gives back the same file.
2. An upload remembers its file name, its size and when it arrived.
3. Every row of the file is kept as it was, with its row number from the sheet.

## Decided

**How raw rows are stored.** One shared table for every upload: `_id`, upload, sheet row number (header is 1), cells, and the pair "written to" (the Table and the row's `_id`), empty until imported. Cells are one JSON column: the values only, as text, in sheet order. Header names are stored once on the upload. A database view pairs each value with its header name by position, so a raw row reads as a list of `{name, value}`. One raw row per upload and row number, enforced by the database. Cells are never edited. Blank rows are stored. Rows are loaded in bulk. Measured on 16-Nov-2026 (Bun 1.4.4, local Postgres 16), 100,000 rows of 30 columns: values only takes 39 MB and loads in 2.6 s; name and value in every cell takes 158 MB and loads in 5.0 s; the CSV itself is 22 MB. Postgres compression gave no saving. Later levers, not in this build: drop raw rows of superseded uploads (they can be re-read from the kept file); a size limit per upload

**Where the uploaded file is kept.** In Postgres. The bytes sit in their own table, apart from the upload record, so listing uploads never reads them and the change-data-capture package can skip that table. The record holds a checksum and the size. No size limit in this build. Storing and fetching go through one small place in the code
