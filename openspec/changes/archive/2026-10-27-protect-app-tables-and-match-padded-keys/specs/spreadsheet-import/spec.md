## MODIFIED Requirements

### Requirement: Add new rows or update the ones that match

The user SHALL be able to choose a column to match file rows against the
table's existing rows: a match updates that row, a file row matching
nothing is added instead, and a row with nothing in any mapped column is
counted and skipped rather than silently mismatched — all three counts
shown before anything commits. An update only changes columns the file
maps, and the user chooses, for each import, whether a mapped cell left
blank clears the matched row's existing value there or leaves it as is.

#### Scenario: Re-importing a corrected file updates instead of duplicating

- **WHEN** a file already imported is corrected and re-imported with the
  same matching column chosen
- **THEN** the changed rows update in place
- **AND** the table's row count does not change

#### Scenario: A blank cell keeps the existing value by default

- **WHEN** a mapped cell is left blank in the file and the user hasn't
  chosen to clear blanks
- **THEN** the matched row keeps whatever value it already had there

#### Scenario: Rows with nothing to import are skipped, not guessed at

- **WHEN** a file has rows with no value in any mapped column
- **THEN** those rows are counted separately and skipped
- **AND** the counts still add up to the file's total rows

#### Scenario: Spaces around a stored value don't stop a match

- **WHEN** a row already in the table holds "A1 " with a trailing space, and
  a file matched on that column carries "A1"
- **THEN** the re-import updates that row instead of adding a second one
