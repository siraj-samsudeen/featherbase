# Checklists

## Purpose

A checklist is a Table whose rows each carry their own list of items to
check off. Opening one of those rows to work through its items is running
it, and each tick records what actually got done.

## Requirements

### Requirement: Run a table shaped like a checklist

A table whose rows each hold their own set of checklist items SHALL offer a
checklist view: picking a run shows its items as tap targets, and ticking
one off saves right away.

#### Scenario: Tick off an item

- **WHEN** the user opens a run and taps an unchecked item
- **THEN** it shows as done immediately, and the run's progress count goes
  up

#### Scenario: Untick an item

- **WHEN** the user taps an item they had ticked
- **THEN** it shows as not done, and the progress count goes back down

### Requirement: A checklist locks when it can no longer be worked on

A run SHALL lock once it reaches its last status, or when its checklist
reads from a read-only connected source; a locked run's items can still be
reviewed, but no longer ticked, noted or photographed.

#### Scenario: A finished run is locked

- **WHEN** a run has advanced to its last status
- **THEN** its items can still be reviewed, but can no longer be ticked,
  noted or photographed

### Requirement: Record evidence on a checklist item

An item marked to need a photo SHALL let the user attach one, taken or
chosen on the spot. A note explaining why an item wasn't done SHALL be
addable to any item not yet ticked, whenever the checklist has a note
column, and stays editable afterward.

#### Scenario: Attach a photo to an item

- **WHEN** the user adds a photo to an item marked to need one
- **THEN** the photo appears attached to that item, viewable from the run

#### Scenario: Add a note before ticking an item

- **WHEN** the user adds a note to an item that isn't ticked yet
- **THEN** the note is attached to that item, and can still be edited later

### Requirement: A new run copies its template

A new run SHALL start with a fresh, unticked copy of its template's items and
a title made from the template and the section or store. Changing the
template later SHALL NOT change runs already started, and nobody can add,
remove or reword a run's items by sending different ones.

#### Scenario: Start a run

- **WHEN** the user starts a run from a template for one section
- **THEN** the run lists the template's items, none ticked, under a title
  naming the template and the section

#### Scenario: Edit the template afterwards

- **WHEN** someone rewords the first item of the template after a run has
  started
- **THEN** the run still shows the original wording

#### Scenario: Send different items

- **WHEN** a request to save a run carries an extra item, or rewords or
  removes one
- **THEN** the run keeps exactly its original items

### Requirement: A run can't be submitted with must-do items open

A run SHALL be refused when submitted while any must-do item is neither
ticked nor excused with a note, and the refusal SHALL leave the run open.

#### Scenario: Submit too early

- **WHEN** the user submits a run with a must-do item still open
- **THEN** the submission is refused, saying must-do items remain, and the
  run stays open

#### Scenario: Excuse an item with a note

- **WHEN** every must-do item is ticked except one that has a note
  explaining why, and the user submits
- **THEN** the run is submitted

### Requirement: A run belongs to the team leader who started it

A team leader SHALL see and work only the runs they started, with their items
and photos. A store manager SHALL see every run.

#### Scenario: Two team leaders

- **WHEN** two team leaders each start a run and one opens the other's
  run, or its photo
- **THEN** they are refused

#### Scenario: A store manager

- **WHEN** a store manager opens the list of runs
- **THEN** they see every team leader's runs

### Requirement: Runs are listed by day

The list of a checklist's runs SHALL group them under the day they belong to, newest first, naming today and yesterday on the reader's own calendar and any older day in full.

#### Scenario: Early morning in India

- **WHEN** a user in India opens the run list at 02:00 and a run is dated today
- **THEN** it sits under Today, not Yesterday

#### Scenario: An older run

- **WHEN** a run is dated 05-Jan-2026 and that was more than a day ago
- **THEN** its heading reads 05-Jan-2026
