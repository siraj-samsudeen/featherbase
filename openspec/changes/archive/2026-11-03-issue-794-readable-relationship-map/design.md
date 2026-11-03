## Context

The relationship map draws what a row links to on the left and what links back on the right, in a wide diagram and, below the widest screens, a stacked list. The diagram wrote each link's name on its line, truncated to 12–15 characters, and named a related collection only "backlink".

## Decisions

### A link is named by its column's label, read from the Table that holds it

A related collection's "via <link>" uses the label the linking column has in the Table that holds it (as its form shows it); a column with no label, or a label that only repeats its name, reads as its name in words ("assigned_to" reads "Assigned To").

Rejected:
- **Always turn the column name into words** — ignores a label a builder chose, so the map and the form would name the same link differently.

### The center row is listed with the same table as an opened collection

With nothing opened, the slot under the map lists the center row with the same table and the same list columns an opened collection uses.

Rejected:
- **A separate summary card for the center row** — a second way of showing a row, with its own choice of fields, beside one the user already reads.

## Risks / Trade-offs

- A related collection reads the holding Table's description to name its link -> already cached and loaded when the collection is opened.
