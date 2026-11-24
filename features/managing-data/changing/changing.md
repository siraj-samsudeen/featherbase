# Changing

The scene: a person is looking at a Table's list and opens, changes, adds or deletes a row.

## Acceptance criteria

Proposed by Claude while building the mock-up screens for real. Not yet agreed by Siraj.

1. Pressing a row's name opens that row beside the list, with every value in a field that suits its type, and marks the row in the list.
2. The record says where its row came from: "from stock.csv row 3".
3. Save keeps the changed values, goes back to the list and says "Saved".
4. A value that cannot be kept is refused: the record comes back with what was typed, says why under that field, and nothing is saved.

   | Field | Typed | Refused with |
   |---|---|---|
   | Code | `S1` | S1 is already used. |
   | Code | blank | Code is required. |
   | Item | blank | Item is required. |
   | Quantity | `forty` | Enter a number, such as 40 or 37.5. |

5. Cancel goes back to the list and keeps nothing.
6. The list has a button to add a row, named after one row of the Table.

   | Table | Button |
   |---|---|
   | Items | New Item |
   | Companies | New Company |
   | Staff | New Staff |

7. The button opens an empty record that says "given by hand". Create adds the row to the end of the list and says "Saved".
8. A new row is refused the same way as a changed one.
9. Delete asks first. Keep leaves the row. Delete removes it and says which row went: "Deleted Brass Hinge".
10. Opening a row the Table does not have shows "Page not found".

## Decided

Delete really removes the row in this build. A raw row's "written to" link is left as it is when its row is
deleted.
