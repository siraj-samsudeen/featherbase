# Comments and History

## Purpose

Every row can carry a running conversation and, for a Table set up to keep
one, a record of who changed what and when — so a row's history doesn't
depend on remembering or asking around.

## Requirements

### Requirement: Comment on a row

Anyone who can read a row SHALL be able to add a comment to it, and every
comment SHALL be visible to anyone else who can read that row.

#### Scenario: Add a comment

- **WHEN** the user comments "Following up with the supplier" on a row
- **THEN** the comment appears there for anyone who can read the row

### Requirement: Mention someone in a comment

Writing @ followed by a person's name in a comment SHALL notify that
person, if they exist.

#### Scenario: A mention notifies

- **WHEN** the user writes "@sarah can you check this" in a comment
- **THEN** Sarah is notified that she was mentioned

### Requirement: See a row's whole history in order

For a Table set up to keep change history, the user SHALL be able to see
its comments and its edits together, in the order they happened, with each
edit showing what changed from and to.

#### Scenario: A comment and an edit side by side

- **WHEN** a row's due date is changed and someone then comments on it
- **THEN** the timeline shows the date change, then the comment, in that
  order

### Requirement: History respects what the viewer can see

The history SHALL still show that an edit happened even when the viewer
can't see every field it touched, but it SHALL leave out the change to any
field they aren't allowed to see.

#### Scenario: A hidden field's change is left out

- **WHEN** an edit changes both a field the user can see and one they
  can't, and the user opens the history
- **THEN** only the field they can see shows a change
