# Browsing

The scene: a Table exists and a person opens its list.

## Acceptance criteria

Proposed by Claude while building the journey `journeys/importing-a-spreadsheet.md`. Not yet agreed by Siraj.

1. The list shows every row in the file's order and says how many there are: "24 rows".
2. Each value is shown the way its type reads best. A blank cell is shown as a dash.

   | Cells in the Column | Shown as |
   |---|---|
   | `2015-01-01`, `2024-12-31`, blank | 01-Jan-2015, 31-Dec-2024, — |
   | `true`, `false`, blank | Yes, No, — |
   | `48`, `37.5`, blank | 48, 37.5, — |
   | `Sales`, `Billing`, `Sales`, `Billing`, blank | Sales, Billing, Sales, Billing, — |
   | `Asha`, `Bala`, blank | Asha, Bala, — |

3. Text is shown exactly as it was written in the file, even when it looks like HTML.
4. Opening a Table Featherbase does not have shows "Page not found".
