# Spec Delta

## MODIFIED Requirements

### Requirement: A single row can be shared beyond its role grants

A specific row SHALL be shareable with a chosen person, giving them reading, editing, or the ability to share it onward, even if their roles alone wouldn't grant that on the table it belongs to. Sharing its reading SHALL also reveal its comments and readable history without revealing activity from any other row.

#### Scenario: Shared with someone outside the role grant

- **WHEN** a row is shared for editing with a user who has no write grant on its table
- **THEN** that user can edit that one row, and no others on the table

#### Scenario: A shared row brings only its own activity

- **WHEN** a user without a role grant receives reading access to one row that has comments and changes
- **THEN** the user can read that row's comments and readable changes, but no activity from other rows

### Requirement: A column can be marked sensitive

A column SHALL be markable so that only roles with the deeper access it requires can see or change it. In the table's list, form, single-row view and change history, it's omitted from what other roles see, and a write to it from them is silently dropped rather than saved.

#### Scenario: A sensitive column is hidden

- **WHEN** a user without the deeper access opens a row that has a sensitive column
- **THEN** the column is absent from what they see, not shown blank or masked

#### Scenario: Earlier sensitive values are hidden too

- **WHEN** the sensitive column changed before the user opened the row's history
- **THEN** neither its earlier nor later value appears there
