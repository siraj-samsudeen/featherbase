# Spec Delta

## MODIFIED Requirements

### Requirement: Comment on a row

People allowed to comment on that table SHALL be able to add a comment to a row. A comment SHALL be visible wherever comments can be read only to someone who can read the row it belongs to.

#### Scenario: Add a comment

- **WHEN** a user with permission to comment on the table comments "Following up with the supplier" on a row
- **THEN** the comment appears there for anyone who can read the row

#### Scenario: A hidden row keeps its comments hidden

- **WHEN** the user can read comments in general but cannot read the row a comment belongs to
- **THEN** the comment and even its presence are absent from everything the user can read or count

### Requirement: See a row's whole history in order

For a Table set up to keep change history, the user SHALL be able to see a readable row's comments and edits together, in the order they happened, with each edit showing only changes to information that user can read.

#### Scenario: A comment and an edit side by side

- **WHEN** a row's due date is changed and someone then comments on it
- **THEN** the timeline shows the date change, then the comment, in that order

#### Scenario: A sensitive change stays hidden

- **WHEN** one edit changes both ordinary information and information the user is not allowed to see
- **THEN** the row's history shows only the ordinary change to that user
