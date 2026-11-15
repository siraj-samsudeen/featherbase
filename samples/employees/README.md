# Sample employee master

Made-up data for building and testing the spreadsheet import. No real person, store or code appears here.
The key is `Employee Code`. Codes have leading zeros on purpose.

| File | Rows | Use |
|---|---|---|
| `employees-clean.csv` | 24 | Build 1: import a clean master |
| `employees-clean-v2.csv` | 24 | Re-import: a later version of the clean file |
| `employees-messy.csv` | 25 | Build 2: import and clean up |

Row numbers below are sheet rows; the header is row 1.

## What changed in `employees-clean-v2.csv`

| Row | Change |
|---|---|
| 2 | Store changed to Hill Road |
| 4 | Job title changed to Senior Stock Keeper |
| 11 | Left on 15-Oct-2026; status Left |
| — | Code 00161 is no longer in the file |
| 25 | New employee, code 00175 |

## Problems planted in `employees-messy.csv`

| Row | Column | Problem |
|---|---|---|
| 3 | Employee Code | Blank key |
| 4 and 5 | Employee Code | Same key twice (00021) |
| 7 | Employee Code | Leading zeros lost (42, was 00042) |
| 8 | Date of Joining | Not a real date (31-Feb-2021) |
| 9 | Date of Joining | A different date format (2019/07/15) |
| 10 | Weekly Hours | A barcode in a number Column (8901234567890) |
| 11 | Weekly Hours | Text in a number Column (forty) |
| 12, 13, 14 | Department | Three spellings of Sales: trailing space, capitals, a typo |
| 15 | Date of Leaving | Before the date of joining |
| 16 | Name | Stray spaces at both ends |
| 17 | Status | Not in the list (Actve) |
| 19 | — | A fully blank row |

Rows 3, 4 and 5 cannot be matched by key. The other rows match the clean file's codes, except row 7, which
matches only if the import decides that 42 and 00042 are the same code.
