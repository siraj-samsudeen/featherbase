# Comments and History

## Purpose

Every row can carry a running conversation and, for a Table set up to keep
one, a record of who changed what and when — so a row's history doesn't
depend on remembering or asking around.

## Requirements

### Requirement: Comment on a row

People allowed to comment on that table SHALL be able to add a comment to a
row, and every comment SHALL be visible to anyone who can read the row.

#### Scenario: Add a comment

- **WHEN** a user with permission to comment on the table comments
  "Following up with the supplier" on a row
- **THEN** the comment appears there for anyone who can read the row

#### Scenario: Not allowed to comment

- **WHEN** a user whose role does not allow commenting tries to comment
- **THEN** it is refused and no comment is saved

### Requirement: Mention someone in a comment

Writing @ followed by a person's username in a comment, or @ followed by
their full name in square brackets, SHALL notify that person, if they exist;
see Notifications, Email and Webhooks. A full name shared by two people
notifies neither, and an email address is never a mention.

#### Scenario: A mention only counts for a real person

- **WHEN** the user writes "@ghost" in a comment and no user by that name
  exists
- **THEN** no notification goes out for that mention

#### Scenario: Two people share a name

- **WHEN** the user writes a full name in brackets and two people have that
  name
- **THEN** neither is notified

#### Scenario: An email address in the text

- **WHEN** the user writes "ask me at ravi@gmail.com" in a comment
- **THEN** no one is notified

### Requirement: See a row's whole history in order

For a Table set up to keep change history, the user SHALL be able to see
its comments and its edits together, in the order they happened, with each
edit showing what changed from and to.

#### Scenario: A comment and an edit side by side

- **WHEN** a row's due date is changed and someone then comments on it
- **THEN** the timeline shows the date change, then the comment, in that
  order

#### Scenario: A Table that keeps no history

- **WHEN** a row of a Table not set up to keep history is edited and
  commented on
- **THEN** its timeline shows the comment but no edits
