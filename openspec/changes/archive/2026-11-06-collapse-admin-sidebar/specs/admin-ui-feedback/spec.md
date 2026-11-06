## ADDED Requirements

### Requirement: The Admin sidebar can be collapsed

At desktop width the Admin SHALL let the person collapse the sidebar, from a control that stays in the top bar and with `Cmd+B` or `Ctrl+B`. The choice SHALL be remembered for that person in that browser. The shortcut SHALL do nothing while the cursor is in a text field or rich-text editor, where the key belongs to the field. At phone width the sidebar SHALL stay the drawer it is, whatever was chosen.

#### Scenario: Collapse and bring back

- **WHEN** the person presses the shortcut or uses the control
- **THEN** the sidebar is hidden
- **AND** the control stays where it was, and using it again brings the sidebar back

#### Scenario: The key belongs to the field while typing

- **WHEN** the person presses the shortcut with the cursor in a text field or rich-text editor
- **THEN** the sidebar stays as it is and the field keeps the key

#### Scenario: Remembered for the person

- **WHEN** the person collapses the sidebar and reloads the page
- **THEN** the sidebar is still collapsed
- **AND** someone else signing in on that browser sees their own choice

#### Scenario: A phone keeps its drawer

- **WHEN** the person collapsed the sidebar on a wider window and opens the Admin at phone width
- **THEN** the menu button opens the drawer as before

### Requirement: A Table's list uses the whole page width

A Table's list SHALL use the whole page rather than the reading width of other pages, so a wide table itself gets the room the sidebar gives up.

#### Scenario: Collapse to give a table the width

- **WHEN** the person collapses the sidebar on a Table's list
- **THEN** the list is wider by the sidebar's width, at any window size

#### Scenario: Other pages keep their reading width

- **WHEN** the person collapses the sidebar on a page that is not a Table's list, on a wide window
- **THEN** that page keeps its reading width
