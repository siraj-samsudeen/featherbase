# Sample employee master

Made-up data for building and testing the spreadsheet import. No real person or code appears here.

The first round uses only `employees-clean.csv`. It is written in the easiest form to read: dates as
`2015-01-01`, yes/no as `true` / `false`, numbers as plain digits, a code that is plainly text.
Harder formats are added later, one at a time.

| File | Rows | Use |
|---|---|---|
| `employees-clean.csv` | 24 | First round: import a clean master |
| `employees-clean-v2.csv` | 24 | Later: re-import of a newer version |
| `employees-messy.csv` | 25 | Later: import and clean up |

## Why each Column is there

| Column | Type it exercises | What it tests |
|---|---|---|
| Employee Code | Text | The key: required and unique |
| Name | Text | Required text |
| Department | Choice | A short fixed list of values |
| Date of Joining | Date | A required date |
| Date of Leaving | Date | A blank cell in an optional Column |
| Active | Yes/No | A true/false value |
| Weekly Hours | Number | A whole number and a decimal (37.5) |

Row numbers below are sheet rows; the header is row 1.

## What changed in `employees-clean-v2.csv`

| Row | Change |
|---|---|
| 2 | Department changed to Billing |
| 4 | Weekly Hours changed to 44 |
| 11 | Left on 2026-10-15; Active false |
| — | Code E0161 is no longer in the file |
| 25 | New employee, code E0175 |

## Problems planted in `employees-messy.csv`

| Row | Column | Problem |
|---|---|---|
| 3 | Employee Code | Blank key |
| 4 and 5 | Employee Code | Same key twice (E0021) |
| 8 | Date of Joining | Not a real date (2021-02-31) |
| 9 | Date of Joining | A different date format (15/07/2019) |
| 10 | Weekly Hours | A barcode in a number Column (8901234567890) |
| 11 | Weekly Hours | Text in a number Column (forty) |
| 12, 13, 14 | Department | Three spellings of Sales: trailing space, capitals, a typo |
| 15 | Date of Leaving | Before the date of joining |
| 16 | Name | Stray spaces at both ends |
| 17 | Active | Not true or false (yse) |
| 19 | — | A fully blank row |
