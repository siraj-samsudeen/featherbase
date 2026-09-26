# Reports and Charts

## Purpose

A report turns a Table's rows into a shaped answer — grouped, totalled,
filtered, exported or charted — without changing any data. Anyone who can
read a Table's rows can build and run a report over it.

## Requirements

### Requirement: Summarize a Table

Opening a Table's summary view SHALL let the user choose which columns show
and group the rows by one of them, with a count and a running total for each
group and for everything together.

#### Scenario: Group orders by status

- **WHEN** the user opens the Order summary, groups it by Status, with Amount
  among the shown columns
- **THEN** each status shows its orders, a count, and the sum of their Amount
- **AND** the bottom shows the same count and sum across the whole summary

### Requirement: Export a summary exactly as shown

The user SHALL be able to download the summary exactly as it appears on
screen — the same columns, in the same groups, with the same totals shown
there.

#### Scenario: Download a grouped summary

- **WHEN** the user exports the Order summary grouped by Status
- **THEN** the file has one row per order under its status group, each
  group's totals as shown on screen, and the grand total as shown on screen,
  in that order

### Requirement: Save and rerun a summary

The user SHALL be able to save the current columns, grouping and filters as a
named report and reopen it later to get the same view over live data.
Anyone who can read the report can run it.

#### Scenario: Reopen a saved report

- **WHEN** the user saves "Open orders by status" and later opens it from the
  saved list
- **THEN** the same columns, grouping and filters apply, over whatever orders
  exist now

### Requirement: Chart a summary report and pin it to a dashboard

A saved summary report SHALL offer a bar chart of its current rows, and the
user can pin that chart onto a dashboard so it keeps recomputing from live
data.

#### Scenario: Pin a report chart

- **WHEN** the user saves an orders-by-status summary report, previews its
  chart, and pins it to the "Sales" dashboard
- **THEN** the chart appears on the dashboard and reflects new orders the
  next time it loads

### Requirement: Ask a precise question with a query report

A query report SHALL run an admin-authored question against the data and
fill in the user's own values for its blanks; it can only read data, never
change it. Only a System Manager may write or change the question itself.
Anyone who can open the report sees its results in full, not narrowed to
what they could otherwise read.

#### Scenario: Run a query report with a filter

- **WHEN** a query report asks for orders placed "from" a date and the user
  fills that date in and runs it
- **THEN** only orders from that date onward appear
- **AND** running it can never change any data, however the question is
  written

### Requirement: Run a script report

A script report SHALL show its own declared filters and, once run, return
whatever columns and rows its logic produces, scoped to what the current
user could otherwise read.

#### Scenario: Run a script report with its filter

- **WHEN** the user opens a script report offering an "Enabled" filter and
  sets it to Yes
- **THEN** only matching rows are returned

### Requirement: Email a report on a schedule

A saved report SHALL be deliverable by email to a list of recipients on a
repeating schedule, attached as a file of its current rows.

#### Scenario: Scheduled delivery

- **WHEN** a scheduled email for "Open orders by status" is set to weekly and
  its time comes
- **THEN** each recipient gets an email with the report's current rows
  attached
- **AND** it is not sent again until a week has passed
