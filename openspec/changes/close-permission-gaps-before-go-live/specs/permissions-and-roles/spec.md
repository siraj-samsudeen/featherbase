## MODIFIED Requirements

### Requirement: A column can be marked sensitive

A column SHALL be markable so that only roles with the deeper access it
requires can see, search or change it. Wherever rows are listed, searched or
opened, that column is omitted for everyone else, and a write to it from them
is silently dropped rather than saved. The lines inside a row follow the
row's own deeper access, and what a save hands back never shows more than
opening the row would.

#### Scenario: A sensitive column is hidden

- **WHEN** a user without the deeper access opens a row that has a sensitive
  column
- **THEN** the column is absent from what they see, not shown blank or
  masked

#### Scenario: A sensitive column on a row's lines

- **WHEN** a user without the deeper access on an order opens it, and its
  lines carry a sensitive unit cost
- **THEN** each line shows its item but not its unit cost, while someone with
  the deeper access on orders sees both

#### Scenario: Saving shows no more than opening

- **WHEN** a user without the deeper access saves a row that has a sensitive
  column
- **THEN** the saved row they get back leaves that column out
