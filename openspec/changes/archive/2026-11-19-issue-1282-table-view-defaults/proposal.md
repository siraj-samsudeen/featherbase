## Why

A person's view of a list is remembered for most choices, but a Table's manager can set a default only for its
columns, from the foot of the Columns menu. Show Retired and Kanban grouping are forgotten on every visit (#1282 A4).

## What Changes

- The View menu's "Make This the Table's Default…" saves the manager's whole view: layout, columns, sort, compact
  rows and the Links tab's choices. The confirm names each in words. It replaces the Columns menu's action.
- A person who has never changed a choice gets the Table's default for it. Their own choices win.
- "Reset to the Table's Default" clears only that person's own choices, and shows only when their view differs.
- Each save is kept with who and when, shows in the team Activity feed, and can be undone while it is still the
  Table's default.
- Show Retired and Kanban grouping are remembered per person per Table.

## Capabilities

### New Capabilities

### Modified Capabilities

- `list-view`: a manager makes their whole view the Table's default; Reset; Undo; Show Retired and grouping remembered.
