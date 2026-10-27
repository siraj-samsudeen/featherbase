# Reports and Charts

## Purpose

A report turns a Table's rows into a shaped answer — grouped, totalled,
filtered, exported or charted — without changing any data. Anyone who can
read a Table's rows can build and run a report over it.

## Requirements

### Requirement: Summarize a Table

Opening a Table's summary view SHALL let the user choose which columns show
and group the rows by one of them, with a count and a running total for each
group and for everything together. The counts and totals SHALL cover every
row that matches, even when the summary lists only the first part of them,
and the summary SHALL then say how many it lists out of how many.

#### Scenario: Group orders by status

- **WHEN** the user opens the Order summary, groups it by Status, with Amount
  among the shown columns
- **THEN** each status shows its orders, a count, and the sum of their Amount
- **AND** the bottom shows the same count and sum across the whole summary

#### Scenario: More orders than the summary lists

- **WHEN** 501 orders match and the summary lists the first 500
- **THEN** the summary says it shows the first 500 of 501
- **AND** the counts and the sum of Amount, for each status and overall,
  include all 501 orders

### Requirement: Export a summary exactly as shown

The user SHALL be able to download the summary as it appears on screen — the
same columns, in the same groups, with the same totals shown there — with
every matching row, including any the summary does not list.

#### Scenario: Download a grouped summary

- **WHEN** the user exports the Order summary grouped by Status
- **THEN** the file has one row per order under its status group, each
  group's totals as shown on screen, and the grand total as shown on screen,
  in that order

#### Scenario: Download a summary longer than the screen

- **WHEN** 501 orders match and the user exports the summary
- **THEN** the file has all 501 orders and the same totals as the screen

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

### Requirement: A scheduled email goes to everyone on the list, once each

A scheduled report email SHALL be sent separately to each recipient, whether the list is separated by commas, semicolons or spaces. It SHALL be sent daily, weekly or monthly as chosen, and a schedule that is switched off, or has no recipients, SHALL send nothing.

#### Scenario: Four recipients

- **WHEN** a schedule lists four addresses and its time comes
- **THEN** each of the four gets their own email

#### Scenario: A switched-off schedule

- **WHEN** a schedule is switched off and its time comes
- **THEN** no email is sent

### Requirement: The emailed file can be a spreadsheet file or a web table

The attachment of a scheduled report SHALL be a CSV file by default, with values containing commas or quotes kept intact, or, when the schedule asks for it, the same rows as a table in a web page.

#### Scenario: A value with a comma

- **WHEN** a report row has the title "Bolt, hex"
- **THEN** the CSV file keeps it as one cell

### Requirement: A chart is drawn from a label, a value or counts

A report chart SHALL show either one bar per row, labelled by one column and sized by another, or, when the chart groups by a column, one bar per distinct value sized by how many rows have it. When the chart is not told which columns to use, it SHALL label by the first column that is not the row's identifier and size by the first numeric column.

#### Scenario: Counts by status

- **WHEN** the user charts a report grouped by status
- **THEN** each status gets a bar sized by the number of rows with that status

#### Scenario: No columns chosen

- **WHEN** a chart is made from a report with a text column followed by a numeric one, and no columns are chosen
- **THEN** the bars are labelled by the text column and sized by the numeric one

### Requirement: Pinning the same chart twice updates it

Pinning a chart to a dashboard under a name that is already there SHALL replace that chart rather than add a second one, so pinning again after changing a report keeps the dashboard tidy.

#### Scenario: Pin again

- **WHEN** the user pins a chart called "Orders by status" to a dashboard that already has one by that name
- **THEN** the dashboard still has one such chart, now the latest

### Requirement: A script report is only for people who may read it

A person SHALL be refused a script report they cannot read, and what a script report returns SHALL be limited to what the person running it could otherwise read.

#### Scenario: No access to the report

- **WHEN** a person with no access to a script report tries to run it
- **THEN** they are refused and nothing runs
