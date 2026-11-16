# Proposing

The scene: a person has uploaded a file and is looking at the Table Featherbase would make from it.

## Sentences

One sentence per rule, in everyday words. Each sentence has exactly one test, named with the sentence word
for word. Where a sentence has a table, the test runs the table's rows as written here. See `TESTING.md`.

1. The Table's name comes from the file name: `employees.csv` gives "Employees".
2. Each header becomes a Column, in the file's order.
3. A Column's type is worked out from its cells.

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

4. A blank cell doesn't count when working out the type. A Column with only blanks is Text.
5. Spaces at the ends of a cell are ignored.
6. The key is proposed as the first Column that is never blank and never repeats.
7. A text Column whose values mostly repeat is proposed as a Choice, with its values in alphabetical order.
    "Mostly" means at least 9 rows in 10 share their value with another row. The key is never a Choice.
8. Nothing is created until the person confirms.

## Decided

**Reading the CSV and working out types.** A well-used CSV library (Papa Parse, to confirm on Bun at setup), returning every cell as text. The file must be comma-separated, UTF-8, headers in the first row. Types are worked out by fresh rules, tried in order on a Column's non-blank cells: every cell `true` or `false` → Yes/No; every cell a plain number (`48`, `37.5`, `-3`) → Number; every cell a real date written `2015-01-01` → Date; it is not the key, and at least 90% of its non-blank rows hold a value that another row also holds → Choice (no fixed limit on the number of values; a few one-off values are tolerated); otherwise Text. A blank cell is empty; an all-blank Column is Text. Spaces at the ends of a cell are ignored. Every row is examined. The key is proposed as the first Column never blank and never repeated. The header is the Column's label as written; its database name is lower case with underscores. The Table's name comes from the file name (`employees.csv` → "Employees"). The person can overrule any of it

**On the screen.** A type is offered only if every cell fits it. Only a Column that is never blank and never
repeats can be picked as the key. The screen shows, for each Column, what Featherbase saw in it, and how the
first rows will look. These two limits go slightly beyond the sentences above; the owner has not yet said
whether to keep them.
