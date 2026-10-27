## ADDED Requirements

### Requirement: Deleting a row takes its activity with it

Deleting a row SHALL also remove its comments, change history, attachments,
shares, assignments and tags, so nothing is left pointing at a row that no
longer exists. A share given for the deleted row never opens a later row
that is given the same id.

#### Scenario: Delete a customer with comments and a file

- **WHEN** a user deletes the customer "Acme", which has a comment, an edit
  in its history, an attached file and a share
- **THEN** the comment, the history, the file and the share are gone with it
- **AND** a new customer later saved as "Acme" starts with none of them
