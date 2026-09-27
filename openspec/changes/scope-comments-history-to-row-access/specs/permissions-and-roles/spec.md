# Spec Delta

## MODIFIED Requirements

### Requirement: A single row can be shared beyond its role grants

A specific row SHALL be shareable with a chosen person, giving them reading,
editing, or the ability to share it onward, even if their roles alone
wouldn't grant that on the table it belongs to. The share grants the chosen
action on that row and its basic columns; sensitive columns still require the
person's deeper field access.

#### Scenario: Shared with someone outside the role grant

- **WHEN** a row is shared for editing with a user who has no write grant on
  its table
- **THEN** that user can edit that one row's basic columns, and no other rows
  on the table

#### Scenario: A share does not elevate field access

- **WHEN** a row with a sensitive budget is shared for editing with a user who
  lacks deeper access to that column
- **THEN** the user can read and edit basic columns on the row
- **AND** the budget is absent from what they read and a change to it is not saved

### Requirement: A column can be marked sensitive

A column SHALL be markable so that only roles with the deeper access it
requires can see or change it. In the table's list, form, single-row view and
change history, it's omitted from what other roles see, and a write to it from
them is silently dropped rather than saved. Sharing its row SHALL NOT grant
that deeper access.

#### Scenario: A sensitive column is hidden

- **WHEN** a user without the deeper access opens a row that has a sensitive
  column
- **THEN** the column is absent from what they see, not shown blank or
  masked

#### Scenario: A shared row keeps its sensitive column hidden

- **WHEN** the user can open a row because it was shared with them but lacks
  the deeper access for one column
- **THEN** that column and its history are absent from what the user sees
