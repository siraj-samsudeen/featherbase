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

### Requirement: A board can group by any of the table's choices

When a table has several columns whose value is one of a set of choices, the board SHALL let the user pick which one the columns follow, and each column SHALL show how many cards it holds. A card whose value is not one of the choices SHALL still be shown, in a column of its own.

#### Scenario: A card with no stage

- **WHEN** a deal has no stage set and the user opens the board grouped by stage
- **THEN** the deal appears in a column for deals without a stage, not missing from the board

### Requirement: Dropping a card where it started changes nothing

Dropping a card back where it came from SHALL NOT change or re-save the row.

#### Scenario: A card dropped back

- **WHEN** the user drags a card and drops it in the column it started in
- **THEN** the deal is left exactly as it was

### Requirement: A calendar pages by month

The calendar SHALL open on the current month and let the user move to the previous and next month, showing the rows whose dates fall in each.

#### Scenario: Next month

- **WHEN** the user moves to the next month
- **THEN** the calendar shows that month and the rows dated in it

### Requirement: A timeline draws only rows with both dates

The timeline SHALL draw a bar only for rows that have both dates, and dragging a bar's end SHALL never move the second date before the first.

#### Scenario: A row with only a start date

- **WHEN** a task has a start date and no end date
- **THEN** it has no bar on the timeline

#### Scenario: Dragging the end too far back

- **WHEN** the user drags a bar's end to before its start
- **THEN** the task's end date becomes its start date

### Requirement: A view that does not fit the table says so

When a table lacks what a view needs, a column of choices for the board, a date for the calendar or two dates for the timeline, the view SHALL say what is missing rather than show an empty page.

#### Scenario: A table with no date

- **WHEN** the user opens the calendar of a table with no date column
- **THEN** the page says the table has no date column
