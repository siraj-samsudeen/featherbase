# Row Editing

## Purpose

Every Table automatically gets one form for opening, creating and editing its
rows — no per-Table screen has to be built. The form shows what changed,
saves valid edits, and never lets an invalid or stale save destroy work
silently.

## Requirements

### Requirement: Open or create a row

Opening one of a Table's rows SHALL show its current values in a form built
from that Table's fields, and creating a new row SHALL open the same kind of
form blank and ready to fill in.

#### Scenario: Open an existing row

- **WHEN** the user opens a row
- **THEN** its saved values appear in the form

#### Scenario: Start a new row

- **WHEN** the user creates a new row
- **THEN** a blank form opens, ready for input

### Requirement: Edit and save

Changing a field SHALL mark the form as not yet saved, and saving SHALL
store every changed value and confirm the save.

#### Scenario: Save an edit

- **WHEN** the user changes a field and saves
- **THEN** the form shows it as saved and keeps the new value

### Requirement: An invalid value blocks the save, in place

Saving with an invalid value SHALL save nothing and instead show an error
next to each field that failed, leaving everything the user typed on screen
to fix.

#### Scenario: Fix a rejected value

- **WHEN** the user enters an invalid value and saves
- **THEN** nothing is saved
- **AND** an error appears beside that field, with the typed value still there

### Requirement: A save that arrives too late is refused

If someone else has changed a row since the user opened it, saving over that
change SHALL be refused rather than silently overwriting it, and the user's
own entered values SHALL remain in the form so nothing is lost.

#### Scenario: Someone else changed it first

- **WHEN** the user tries to save a row that another person changed after the
  user opened it
- **THEN** the save is refused
- **AND** the values the user entered stay in the form

### Requirement: See a change made while the row is open

While a row is open, the user SHALL be told when someone else has just
changed it elsewhere, and be offered a way to bring in that latest version.

#### Scenario: Notified of a change elsewhere

- **WHEN** another person saves changes to the row the user currently has
  open
- **THEN** the user sees a notice that it changed elsewhere, with a way to
  load the latest version

### Requirement: Attach files to a row

The user SHALL be able to attach a file to a row, see every file attached to
it, open any of them, and remove one without disturbing the others.

#### Scenario: Attach and remove a file

- **WHEN** the user attaches a file to a row and later removes it
- **THEN** it is listed among the row's attachments until removed
- **AND** removing it takes it out of that list, leaving any other attachment
  untouched

### Requirement: Peek at a linked row without leaving the page

Clicking a link to another row SHALL open it in a read-only panel over the
current page rather than navigating away. From there the user can follow
another link deeper, step back one link at a time, or open what they're
looking at as a full page; closing the panel always returns to the page they
started from unchanged.

#### Scenario: Follow a chain of links and come back

- **WHEN** the user clicks a linked row, then clicks one of its own links, and
  then closes the panel
- **THEN** they see both linked rows in turn without leaving the original page
- **AND** closing the panel leaves them back on the original page

### Requirement: Each field gets a control that fits its type

A row's form SHALL give each field the control that suits what it holds: a
text box for text, a number box for numbers, a checkbox for yes/no, a drop-down
for a choice, a date picker for a date, and a larger box for long text.

#### Scenario: Different fields, different controls

- **WHEN** the user opens a row that has a text field, a number, a yes/no
  field, a choice and a date
- **THEN** each one appears as the control that suits it, filled with the row's
  saved value

### Requirement: Read-only and hidden fields

A field marked read-only SHALL show in the form but not accept edits, and a
field marked hidden SHALL not be shown at all.

#### Scenario: A locked field

- **WHEN** the user opens a row whose Table has a read-only field and a hidden
  field
- **THEN** the read-only field cannot be changed
- **AND** the hidden field is nowhere on the form

### Requirement: Pick a linked row by typing

A field that links to another Table's rows SHALL offer matching rows as the
user types, fill the field with the one they pick, and offer a way to create
a new row to link to.

#### Scenario: Find a customer by a few letters

- **WHEN** the user types "Ltd" into a customer link and picks "Globex Ltd"
- **THEN** only customers matching "Ltd" were offered, the field shows
  "Globex Ltd", and saving keeps it

### Requirement: Every form control can be found by its name

Every control on a form SHALL be tied to its visible label, so assistive tools
find it by that name and the name stays correct after the user edits, adds,
removes or reorders rows. A required marker never replaces the field's name.
Each cell in a grid of nested rows is named by its grid, column and row
position, so two grids with the same columns never clash.

#### Scenario: Find a field by its label

- **WHEN** a form shows a text field, a required field, a checkbox, a choice,
  a linked-row field and an attachment field
- **THEN** each control can be found by its label, and still can after the
  user edits one of them

#### Scenario: Tell repeated grid cells apart

- **WHEN** two grids of nested rows share the same column names and the user
  moves or removes a row
- **THEN** every cell is still named by its grid, column and current row
  position

#### Scenario: Controls keep their place when rows move

- **WHEN** the user edits, reorders or removes nested rows, saved or not yet
  saved
- **THEN** the cells that remain keep what the user typed and their keyboard
  focus

### Requirement: Attach buttons say which field they belong to

Each attach button on a form SHALL name both its action and its field, and
pressing it by keyboard SHALL open the file chooser for that field.

#### Scenario: Two attach fields on one form

- **WHEN** a form has two file fields and one image field and the user
  presses an attach button with the keyboard
- **THEN** the button's name says which field it is for, and that field's file
  chooser opens
