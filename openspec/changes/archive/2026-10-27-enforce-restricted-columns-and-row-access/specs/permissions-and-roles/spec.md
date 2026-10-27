## MODIFIED Requirements

### Requirement: A column can be marked sensitive

A column SHALL be markable so that only roles with the deeper access it
requires can see, search or change it. Wherever rows are listed, searched,
opened, printed or returned after a save, that column is omitted for
everyone else, and a write to it from them is silently dropped rather than
saved. A sensitive column in a row's line items is treated the same way: it
shows to someone whose access to the row, or to the line items themselves,
reaches it.

#### Scenario: A sensitive column is hidden

- **WHEN** a user without the deeper access opens a row that has a sensitive
  column
- **THEN** the column is absent from what they see, not shown blank or
  masked

#### Scenario: A sensitive column in the line items

- **WHEN** a user without the deeper access opens a quote whose lines carry a
  sensitive unit cost, edits a line and saves
- **THEN** no line shows the unit cost, in the form, in the saved reply or in
  print, and the stored unit costs are unchanged
