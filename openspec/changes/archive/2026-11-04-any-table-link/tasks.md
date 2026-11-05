## 1. Server

- [x] 1.1 A link column names its Table column (`table_column`); its `choices` list the allowed Tables, checked to be Tables that store rows
- [x] 1.2 A save checks the Table is allowed, the row exists, and a new or changed link's row is readable
- [x] 1.3 Deleting a linked row is refused; a row's new id, its Table's new name and the Table column's new name carry the link
- [x] 1.4 A Table that a link allows or points into can't be deleted

## 2. Web

- [x] 2.1 The form picks the Table, then its row by title; another Table clears the row; a row that can't be read shows "(no access)"
- [x] 2.2 A list shows the linked row's title as a link
- [x] 2.3 The column editor adds "Link to a row of any Table" as two columns
