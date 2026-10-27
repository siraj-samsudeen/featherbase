# Admin UI Feedback Specification

## Purpose

Admin UI Feedback covers Admin behavior that doesn't belong to a more
specific capability: how the search bar opens what it matches, the keyboard
shortcuts for common moves, how a user's theme follows them, what the table
builder and the data-source preview tell the user before they commit, and
how turning on a data source's table completes its foreign keys into
References. Recent search history and Explore are covered by Search and
Explore; language preference is covered by Personal Preferences; and
browsing what a data source holds is covered by External Data Sources.

## Requirements

### Requirement: The search bar opens what it finds

Searching from anywhere in the Admin SHALL offer the Tables, commands and
records that match, plus a way to start a new row in a matching Table, and
opens whichever one the user picks. Pressing Enter opens the Table whose name
was typed exactly, and otherwise the first matching record.

#### Scenario: A record and a Table both match

- **WHEN** a user searches a record's name and then a Table's name
- **THEN** picking the record opens its form, and picking the Table's
  new-row result opens a blank form for that Table

#### Scenario: Enter on a Table's name

- **WHEN** a user types a Table's exact name and presses Enter
- **THEN** that Table's list opens

#### Scenario: Run a command

- **WHEN** a user types part of a command's name, such as going to the Admin
  home, and picks it
- **THEN** the command runs

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

### Requirement: Theme and colour palette follow the user, not the device

Choosing a theme or colour palette SHALL apply it right away and save it to
the user's own account, so it's there again the next time they sign in on
any device — without ever showing another account's choice on a shared
browser.

#### Scenario: Two choices, two accounts

- **WHEN** a user picks Ivory and dark mode and then reloads the page
- **THEN** both choices are still active, and signing in as a different
  user shows that user's own theme and palette instead

### Requirement: Turning on a source table completes matching foreign keys into References

When a builder turns one of a data source's tables into a Featherbase
table, a column the source declares as a foreign key SHALL become a
Reference once its target table has also been turned on with a matching id
column — whichever of the two tables is turned on first.

#### Scenario: The target arrives after the child

- **WHEN** a table is turned on before the table its foreign key points to,
  and that target is turned on afterwards
- **THEN** the first table's column becomes a Reference to the target once
  it arrives, with no need to turn the first table on again

### Requirement: Search results say what each one opens

Search results SHALL tell commands, Table lists, new-row actions and records
apart, with a heading or self-describing text. A Table result names its
module and says it opens the list; a record result names the Table it
belongs to; a new-row action is never labelled like the command to create a
Table. Clicking any result goes where it always did, and Enter opens an
exactly named Table's list before considering records.

#### Scenario: One word, four kinds of result

- **WHEN** the user searches for a word that is a command, a Table, a new-row
  action and a record all at once
- **THEN** the four are distinguishable, and Enter opens the Table's list

### Requirement: appearance_writes_settle_consistently

Rapid theme or palette selections SHALL remain optimistic without an older completion replacing a newer intent. Once writes settle, the DOM, preference control, user-scoped mirror and cached preference SHALL agree with the last successfully persisted selection. A failed latest write SHALL restore the last confirmed preference; a failed older write SHALL not erase a newer pending selection. Pending completions from an abandoned session SHALL not alter a new session's presentation.

#### Scenario: slow_older_write_then_latest_failure
- **WHEN** Ivory is selected, then Indigo before Ivory completes, and Ivory succeeds but Indigo fails
- **THEN** Indigo remains visible while pending and all client representations finally return to Ivory

#### Scenario: earlier_failure_then_latest_success
- **WHEN** a first theme or palette write fails while a later choice is pending and the later write succeeds
- **THEN** the later choice remains visible and becomes the persisted preference

### Requirement: appearance_text_roles_meet_contrast

All four Admin palettes in light and dark mode SHALL provide independent link, status-text and primary-button foreground/background roles. Links against canvas, surface and subtle backgrounds, status text against those backgrounds and matching status tints, and enabled primary button text in normal and hover states SHALL have WCAG AA contrast of at least 4.5:1. Accent and text roles SHALL be independently tunable.

#### Scenario: palette_mode_role_matrix
- **WHEN** Classic, Ivory, Graphite and Indigo are each rendered in light and dark mode
- **THEN** the affected role pairs meet 4.5:1 including Ivory links/buttons and Indigo success text

### Requirement: A workbook with several sheets says which sheet is used

When the file dropped into the table builder has several sheets, the builder
SHALL show a warning right under the drop area naming the sheet it used and
each sheet it ignored, with a link to the import wizard. Only the first sheet
is used. Clearing the file, or replacing it with a one-sheet file, removes the
warning.

#### Scenario: A workbook with three sheets

- **WHEN** the user drops a workbook with sheets Zones, Stores and Prices
  and then replaces it with a one-sheet file
- **THEN** the warning first names Zones as used and Stores and Prices as
  ignored, and then disappears

### Requirement: A source preview explains which columns become links

Before a data source's table is turned on, its preview SHALL show each
column's name, its type in the source and the type Featherbase would give it.
A column the source declares as a foreign key shows the schema and table it
points to. It is proposed as a link to another Table only when its target is
turned on with a matching key, or is selected to be turned on in the same
step; any other foreign-key column keeps its plain type and says the target
must be turned on first. Ordinary and primary-key columns are never presented
as links, and previewing changes nothing.

#### Scenario: Only matching targets become links

- **WHEN** the preview shows columns pointing at a selected table's key, a
  same-named table in another schema, an unselected table and a non-key column
- **THEN** only the first is proposed as a link, and every foreign-key column
  still shows its own distinct target
