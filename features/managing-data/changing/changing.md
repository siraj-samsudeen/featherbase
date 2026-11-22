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

## Decided

Delete really removes the row in this build. A raw row's "written to" link is left as it is when its row is
deleted.
