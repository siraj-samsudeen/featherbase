## MODIFIED Requirements

### Requirement: Comment on a row

People allowed to comment on that table SHALL be able to add a comment to a
row they can open, and every comment SHALL be visible to anyone who can read
the row, and to nobody who can't, whatever else they may do with comments.

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

#### Scenario: Comments on a row the user cannot open stay hidden

- **WHEN** a user whose role may read comments looks for the comments on a
  row they cannot open
- **THEN** they find none, and opening one of those comments directly is
  refused

### Requirement: See a row's whole history in order

For a Table set up to keep change history, the user SHALL be able to see
its comments and its edits together, in the order they happened, with each
edit showing what changed from and to. A row's history SHALL be seen only
through the row itself, by someone who can read it, and an edit to a column
hidden from them is left out.

#### Scenario: A comment and an edit side by side

- **WHEN** a row's due date is changed and someone then comments on it
- **THEN** the timeline shows the date change, then the comment, in that
  order

#### Scenario: A Table that keeps no history

- **WHEN** a row of a Table not set up to keep history is edited and
  commented on
- **THEN** its timeline shows the comment but no edits

#### Scenario: History only through the row

- **WHEN** a user tries to read the record of edits for a row other than by
  opening the row's history
- **THEN** it is refused, while the row's own history still shows its edits
