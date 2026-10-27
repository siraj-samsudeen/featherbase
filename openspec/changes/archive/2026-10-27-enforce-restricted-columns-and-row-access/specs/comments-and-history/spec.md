## MODIFIED Requirements

### Requirement: Comment on a row

People allowed to comment on that table SHALL be able to add a comment to a
row they can open, and every comment SHALL be visible to anyone who can read
the row, and to no one else, whatever their access to comments in general.

#### Scenario: Add a comment

- **WHEN** a user with permission to comment on the table comments
  "Following up with the supplier" on a row
- **THEN** the comment appears there for anyone who can read the row

#### Scenario: Not allowed to comment

- **WHEN** a user whose role does not allow commenting tries to comment
- **THEN** it is refused and no comment is saved

#### Scenario: A row the user cannot open

- **WHEN** a user whose role may comment, but who cannot read a row, tries to
  comment on it by naming it
- **THEN** it is refused, no comment is saved and nobody mentioned in it is
  notified

#### Scenario: Comments on someone else's row

- **WHEN** a user who may read only their own orders looks through all
  comments
- **THEN** they see the comments on their own orders and none on anyone
  else's

## ADDED Requirements

### Requirement: History follows the row

A row's edits SHALL be visible only to someone who can open the row, and an
edit SHALL never show a change to a column hidden from them.

#### Scenario: A change to a hidden column

- **WHEN** a case's subject and its sensitive payout are changed together,
  and a user without the deeper access opens the case's history
- **THEN** they see the subject change and nothing about the payout
