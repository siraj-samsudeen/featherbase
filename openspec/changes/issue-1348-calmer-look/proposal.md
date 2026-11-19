## Why

The calmer look (#1348, agreed by Siraj on 19-Nov-2026, boards in docs/design/mockups/look-and-relationships.html)
makes Compact Rows a row height, not a shorter list: board 1 draws Compact with the same columns as Comfortable,
and spec item 8 describes it as density only. The list-view spec still says Compact is the list's short form.

## What Changes

- A list's rows are Comfortable (the default) or Compact Rows, switched with the shared segmented control and
  remembered per person and Table, as before.
- Compact Rows keeps every column the person shows; it changes only the row height, the text size and the
  chips. A person who wants fewer columns hides them or saves a view.
- The look itself (fills, the header band, chips) is styling and carries no requirement.

## Capabilities

### New Capabilities

### Modified Capabilities

- `list-view`: Compact Rows is a row height and keeps every column; a list row is one line in both.

## Impact

Supersedes the "leads with each row's name and a few key values" part of the unarchived change
`issue-910-relational-navigation` (requirement "A compact list, remembered per table"); relational navigation
drops that part when it archives. The UI owner agreed on 19-Nov-2026.
