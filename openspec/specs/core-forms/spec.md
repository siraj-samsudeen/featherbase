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
