## ADDED Requirements

### Requirement: A row with comments, history, attachments or shares can't be deleted

Deleting a row SHALL be refused while it has comments, change history,
attachments or shares, so no one's work is ever lost with it. The user is
told what is holding it and how many of each.

#### Scenario: Delete a customer someone has commented on

- **WHEN** a user tries to delete the customer "Acme", which has two comments
- **THEN** the deletion is refused, saying it has 2 comments
- **AND** the customer and its comments remain exactly as they were
