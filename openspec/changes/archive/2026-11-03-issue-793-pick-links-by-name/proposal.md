## Why

A link to another table's row is known to people by its name, but two places ask for its id instead (#793). On a list, the quick filter for a link column (an order's customer, an employee's designation) is a text box that matches the stored id, so typing a name finds nothing. On a form, a link to a table with no hand-made picker searches and shows row ids, so choosing a customer means knowing its id.

## What Changes

- A link column's quick filter on a list becomes a picker: type part of a name, pick the row, and the list shows only the rows linked to it. It only picks existing rows; it never offers to create one.
- The picked filter reads as the row's name and clears in one click.
- A form's link field searches and shows the linked table's title (the value that names its rows), not its id, for every table without a picker of its own.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `list-view`, in the order a person meets them: a link column's quick filter picks a row by its name; a picked link filter reads by the row's name; it clears in one click; the quick filter wording no longer says "box".
- `core-forms`: a link field finds and shows rows by their title.

## Impact

- List (`apps/web/src/components/ListView.tsx`): the quick filters render a link picker for a link column, with a clear control.
- Form (`apps/web/src/components/FormView.tsx`): the link picker falls back to the target table's title column, and can leave out "create new" when used as a filter.
- Not here: lists showing titles first and link cells reading as names (#792).
