# List View

## ADDED Requirements

### Requirement: A list's rows are Comfortable or Compact

A list SHALL show its rows Comfortable by default, and the user SHALL be able to switch them to Compact Rows:
shorter rows with smaller text. Compact Rows SHALL keep every column the list shows. The choice SHALL be
remembered for that user on that table.

#### Scenario: Compact keeps the columns

- **WHEN** the user switches the list of sites to Compact Rows
- **THEN** the rows are shorter and every column of the list still shows

#### Scenario: The choice is kept per table

- **WHEN** the user who chose Compact Rows for sites signs in again
- **THEN** the list of sites opens in Compact Rows
- **AND** the list of plants opens Comfortable

## MODIFIED Requirements

### Requirement: A list row is one line

Every row of a list shown as a table, and its header, SHALL be one line, in both
Comfortable and Compact Rows, whatever its values hold. A long value SHALL be
clipped with an ellipsis and SHALL show in full on hover and on the row's page.
A column SHALL be as wide as its content up to a maximum.

#### Scenario: A very long note

- **WHEN** a row holds a note of several hundred characters
- **THEN** the row is as tall as its neighbours and the note ends in an ellipsis
- **AND** hovering the note shows all of it

#### Scenario: A value that fits

- **WHEN** the person hovers a value that isn't clipped
- **THEN** no tooltip repeats it
