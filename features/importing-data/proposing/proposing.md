# Proposing

The scene: a person has given Featherbase a file and is looking at the Table it would make from it.

## Acceptance criteria

Proposed by Claude while building the journey `journeys/importing-a-spreadsheet.md`. Not yet agreed by Siraj.

1. The Table's name comes from the file name: `employees.csv` gives "Employees".
2. It says how many rows and how many Columns the file has.
3. Each header becomes a Column, in the file's order.
4. A Column's type is worked out from its filled cells. A blank cell does not count.

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

5. A Text Column whose values mostly repeat is a Choice, and says how many different values it has. "Mostly"
   means at least 9 filled cells in 10 share their value with another cell.
