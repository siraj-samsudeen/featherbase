## ADDED Requirements

### Requirement: A screen that can't show what was asked says why

When a screen can't show what was asked for, it SHALL say so on one shared
page, in plain words, as one of three: not found, no access, or couldn't open.
The page names the thing by its readable label and gives one way forward:
back to its list, the Admin home, or Try again for a failure. It never shows a
bare error line or an internal name (#1327).

#### Scenario: A record that isn't there

- **WHEN** a user opens the address of a record that doesn't exist
- **THEN** the page says no record of that Table has that ID, inside the Admin, with a way back to the Table's list

#### Scenario: A load that failed

- **WHEN** a record can't be loaded because the server didn't answer
- **THEN** the page says it couldn't be opened, and Try again loads it
