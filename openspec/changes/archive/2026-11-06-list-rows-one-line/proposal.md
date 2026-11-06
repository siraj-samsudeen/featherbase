## Why

On a master Table with a long note, each row wrapped so far that only two fit on screen, and the table was cut off at the right edge with no sign of more columns (#1015). Password managers offered themselves in filter boxes and knocked them out of line (#1016). The controls took about half the screen before the first row (#1017).

## What Changes

- Every row and the header of a list table is one line. Long values clip with an ellipsis and show in full on hover, columns stop at a maximum width, a fade and arrow signal more columns to the right, and the row's name stays in view while scrolling sideways. Compact stays name plus two values, also one line.
- Filter boxes are marked for password managers to ignore.
- The Add filter row stays closed behind a button, filter boxes and layout choices share a line, the count reads on the title's line, and a path of one step stays beside its buttons.
- Phone cards are unchanged.

## Capabilities

### Modified Capabilities

- `list-view`: one-line rows, filter boxes left alone by password managers, controls that leave room for rows.

## Impact

- `apps/web/src/components/ListView.tsx`, a new `list-one-line.tsx`, and `packages/shop-floor/src/PathBar.tsx`. No server, schema or app version change.
