# Board, Calendar and Timeline Views

## Purpose

Beyond its plain list, a Table's rows can be seen as a kanban board, a
calendar or a timeline when its columns fit that shape — the same rows,
arranged for a different kind of work.

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
