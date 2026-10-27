## MODIFIED Requirements

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
