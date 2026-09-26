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
