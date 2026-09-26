# Board, Calendar and Timeline Views

## Purpose

Beyond its plain list, a Table's rows can be seen as a kanban board, a
calendar, a timeline or a checklist when its columns fit that shape — the
same rows, arranged for a different kind of work.

## Requirements

### Requirement: See rows as a board grouped by a choice

A table with a column whose value is one of a set of choices SHALL offer a
board view: one column per choice, cards for its rows, and dragging a card
into another column SHALL set that row's value to the column it landed in.

#### Scenario: Move a card between columns

- **WHEN** the user drags a "Deals" card from "Open" to "Won"
- **THEN** the card appears under "Won", and the deal's stage is now "Won"

### Requirement: See rows placed on a calendar

A table with a date column SHALL offer a calendar view showing each row on
the day its date falls on, and dragging a row's entry to another day SHALL
change that row's date to the day it was dropped on.

#### Scenario: Move an event to another day

- **WHEN** the user drags a task's calendar entry from the 3rd to the 5th
- **THEN** the task now shows on the 5th, and its date column reads the 5th

### Requirement: See rows as a timeline

A table with two date columns SHALL offer a timeline (Gantt) view, drawing
each row as a bar from its first date to its second; dragging a bar's end
SHALL change that row's second date to match.

#### Scenario: Resize a bar

- **WHEN** the user drags the end of a task's bar three days later
- **THEN** the bar now reaches that day, and the task's end date moves with
  it

### Requirement: Run a table shaped like a checklist

A table whose rows each hold their own set of checklist items SHALL offer a
checklist view: picking a run shows its items as tap targets, ticking one
off saves right away, and a run that has reached its last status locks —
its items can still be reviewed, but no longer changed.

#### Scenario: Tick off an item

- **WHEN** the user opens a run and taps an unchecked item
- **THEN** it shows as done immediately, and the run's progress count goes
  up

#### Scenario: A finished run is locked

- **WHEN** a run has advanced to its last status
- **THEN** its items can still be reviewed, but can no longer be ticked,
  noted or photographed

### Requirement: Record evidence on a checklist item

An item that calls for a photo or a note SHALL let the user attach one while
running the checklist — a photo taken or chosen on the spot, or a note
explaining why the item wasn't done.

#### Scenario: Attach a photo to an item

- **WHEN** the user adds a photo to an item that calls for one
- **THEN** the photo appears attached to that item, viewable from the run
