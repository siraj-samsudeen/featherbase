# Confirming

The scene: a person is looking at the proposal and decides to create the Table.

## Sentences

One sentence per rule, in everyday words. Each sentence has exactly one test, named with the sentence word
for word. Where a sentence has a table, the test runs the table's rows as written here. See `TESTING.md`.

1. Before confirming, the person can change the Table's name, any Column's type and the key.
2. Confirming creates the Table and brings in every row.
3. Each value is stored as its Column's type.

    | Type | In the file | Stored as |
    |---|---|---|
    | Number | `37.5` | 37.5, exactly |
    | Date | `2015-01-01` | 1 January 2015 |
    | Yes/No | `true` | yes |
    | Choice | `Sales` | Sales |
    | any | blank | empty |

4. Each row remembers the upload and the sheet row it came from.
5. A Table name already in use is refused, and nothing is created.

## Decided

**How a Choice is stored.** The row holds the word (`department = 'Sales'`). One shared table holds every list: Column, value, position, retired; a value appears once per Column. The import fills the list from the sheet's distinct values in alphabetical order; the form reads it; a save outside it is refused. A Column is proposed as a Choice only if it is text, is not the key, and at least 90% of its non-blank rows hold a value that another row also holds (decision 5); there is no fixed limit on the number of values; the person can overrule. Matching is exact; blank is allowed unless the Column is required

The import is one transaction and runs while the person waits: the Table's definition, the Postgres table,
the Choice lists, the rows and each raw row's "written to" link happen together or not at all.
