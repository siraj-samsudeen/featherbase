# Proposing

The scene: a person has given Featherbase a file and is looking at the Table it would make from it.

## Acceptance criteria

Proposed by Claude while building the journey `journeys/importing-a-spreadsheet.md`. Not yet agreed by Siraj.

1. The Table's name comes from the file name: `employees.csv` gives "Employees". It is shown in a field
   labelled "Table name".
2. It says how many rows and how many columns the file has: "24 rows and 7 columns".
3. Each header becomes a Column, in the file's order.
4. A Column's type is worked out from its filled cells and shown as the chosen type. A blank cell does not count.

   | Cells in the Column | Type |
   |---|---|
   | `true`, `false`, `true` | Yes/No |
   | `48`, `37.5`, `-3` | Number |
   | `2015-01-01`, `2024-12-31` | Date |
   | `2015-01-01`, blank, blank | Date |
   | `2015-01-01`, `2021-02-31` | Text |
   | `48`, `forty` | Text |
   | `Asha`, `Bala`, `Chitra` | Text |
   | blank, blank | Text |

5. A Text Column whose values mostly repeat is proposed as a Choice. "Mostly" means at least 9 filled cells in
   10 share their value with another cell.
6. The first Column that is never blank and never repeats is chosen as the key.
7. A file saved on Windows reads the same as one saved anywhere else.
8. The file's name and its headers are shown exactly as written, even when they look like HTML.
9. A type can be chosen only if every filled cell fits it. Choice fits when the values mostly repeat.

   | Cells in the Column | Types that can be chosen |
   |---|---|
   | `48`, `40`, `48`, `40` | Text, Number, Choice |
   | `48`, `37.5`, `-3` | Text, Number |
   | `true`, `false`, `true`, `false` | Text, Yes/No, Choice |
   | `2015-01-01`, `2024-12-31` | Text, Date |
   | `Sales`, `Billing`, `Sales`, `Billing` | Text, Choice |
   | `Asha`, `Bala` | Text |
   | blank, blank | Text |

10. Only a Column that is never blank and never repeats can be chosen as the key.
11. Beside each Column, Featherbase says what it saw in the cells, with a few of them as examples. For the
    Column chosen as the key it says "Never blank, never repeats."

    | Cells in the Column | What Featherbase saw |
    |---|---|
    | `Asha`, `Bala`, `Chitra` | 3 different values. Asha, Bala |
    | `Asha`, blank, `Chitra` | 2 different values, 1 blank. Asha |
    | `Sales`, `Billing`, `Sales`, `Billing` | 2 values, each used several times: Billing Sales |
    | `2015-01-01`, `2016-06-04`, `2017-11-07` | Every cell is a date. 2015-01-01, 2016-06-04 |
    | `2025-05-09`, blank, blank | 1 date, 2 blank. 2025-05-09 |
    | `true`, `false`, `true` | Every cell is true or false |
    | `true`, blank, `false` | 2 cells are true or false, 1 blank |
    | `48`, `40`, `37.5`, `36` | Every cell is a number. 48, 40, 37.5 |
    | `48`, blank, `36.5` | 2 numbers, 1 blank. 48 |
    | blank, blank | Every cell is blank. |
