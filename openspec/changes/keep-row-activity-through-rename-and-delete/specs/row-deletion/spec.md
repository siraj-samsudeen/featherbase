## ADDED Requirements

### Requirement: Deleting a row takes its activity with it

Deleting a row SHALL also remove its comments, change history,
attachments, shares, assignments, tags and notifications, so nothing is
left pointing at a row that no longer exists. A share given for the
deleted row never opens a later row that is given the same id. The record
of who opened the row and of emails already sent is kept. An installed
app's row that still has comments or history is refused instead, as that
app's rules say.

#### Scenario: Delete a customer with comments and a file

- **WHEN** a user deletes the customer "Acme", which has a comment, an edit
  in its history, an attached file and a share
- **THEN** the comment, the history, the file and the share are gone with it
- **AND** a new customer later saved as "Acme" starts with none of them

### Requirement: Deleting a row never widens anyone's access

A person limited to certain rows SHALL stay limited after one of those rows
is deleted; deleting it never opens the rest of the table to them.

#### Scenario: The only customer a person may see is deleted

- **WHEN** a person who may see only the customer "Acme" deletes it
- **THEN** they see no customers, rather than all of them
