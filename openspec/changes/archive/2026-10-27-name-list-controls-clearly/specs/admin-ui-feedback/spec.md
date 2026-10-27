## MODIFIED Requirements

### Requirement: The Admin has keyboard shortcuts for the common moves

The Admin SHALL let the user jump to the search bar, save the open form,
start a new row of the Table they are on, and go to the Admin home from the
keyboard. Shortcuts that are plain letters do nothing while the user is
typing in a field.

#### Scenario: Save without the mouse

- **WHEN** the user edits a field and presses the save shortcut
- **THEN** the form saves and says so

#### Scenario: Go home, but not while typing

- **WHEN** the user presses "g" then "d" with the cursor in a field, and then
  again with the cursor on the page itself
- **THEN** only the second time does the Admin home open

#### Scenario: Jump to search or start a new row

- **WHEN** the user presses the search shortcut, or the new-row shortcut
  while looking at a Table's list
- **THEN** the cursor lands in the search bar, or a blank form for that
  Table opens

#### Scenario: No new row away from a Table

- **WHEN** the user presses the new-row shortcut on an Admin page that is not
  a Table, such as the jobs page
- **THEN** the page stays as it is
