# Table Merge

## Purpose

Sometimes two tables turn out to be the same thing under different names.
Merging folds one table's rows into another, column by column, without
guessing which columns actually match and without touching the table the
rows came from.

## Requirements

### Requirement: Merging copies rows into another table and leaves the source alone

Merging SHALL copy the source table's rows into a table the builder chooses,
and SHALL leave the source table and its rows exactly as they were — merging
never deletes the source.

#### Scenario: The source survives its own merge

- **WHEN** a table's rows are merged into another table
- **THEN** the source table still exists afterward with all of its original
  rows

### Requirement: Columns are paired only when they clearly match; nothing else is guessed

Merging SHALL pair a source column with a destination column automatically
only when their names are the same once case, spacing and punctuation are
ignored. Every other column SHALL be left unpaired until the builder says
where it goes, shown alongside a few of its actual values to help decide.

#### Scenario: A misspelled column isn't paired for the builder

- **WHEN** a source column named "Glor" and a destination column named
  "Floor" are otherwise the same thing
- **THEN** they are not paired automatically, and the builder must pair them
  by hand

### Requirement: Merged values are converted to fit, or the row is reported as failed

A value being merged SHALL be converted to the destination column's type. A
value that can't be converted SHALL be reported as a failed row rather than
merged incorrectly or silently dropped.

#### Scenario: An unconvertable value is reported, not guessed at

- **WHEN** a text value that isn't a number is merged into a number column
- **THEN** that row is reported as failed, and its own value is not stored

### Requirement: A merge too large for the screen is refused, not run partway

If the source has more rows than the merge screen can handle in one run, the
merge SHALL be refused outright, saying so, rather than merging only the
first portion.

#### Scenario: An oversized source is refused whole

- **WHEN** a source table's row count is over the screen's limit
- **THEN** the merge does not run at all, and the builder is told the table
  is too large for this screen

### Requirement: A finished merge reports its outcome and can be undone

After a merge, the builder SHALL see how many rows were added and any that
failed. The merge can be undone later from the destination table's import
history; a merged row someone has edited since is left as it is and named as
skipped.

#### Scenario: Undo removes exactly the merged rows

- **WHEN** a merge that added rows is undone from the destination's import
  history, and nobody has edited those rows since
- **THEN** those added rows are removed and the destination is back to how
  it was before the merge
