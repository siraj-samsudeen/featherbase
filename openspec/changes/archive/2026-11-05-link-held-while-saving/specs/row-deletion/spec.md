## MODIFIED Requirements

### Requirement: A row still linked from elsewhere can't be deleted

If another row anywhere still refers to this one, deleting it SHALL be
refused, and the user SHALL be told which row is holding onto it. This SHALL
hold for a link being saved at the same moment as the deletion. Saving a row
SHALL NOT wait for saves of other rows that link to it.

#### Scenario: Blocked by a reference

- **WHEN** a user tries to delete a row that another row still refers to
- **THEN** the deletion is refused
- **AND** the user is told which row refers to it

#### Scenario: A link saved at the same moment

- **WHEN** one user saves an order linking customer Acme while another deletes Acme
- **THEN** either the deletion is refused because the order links to Acme, or the save is refused because Acme no longer exists
- **AND** no order is left linking to a customer that is gone

#### Scenario: Editing the linked row does not wait

- **WHEN** an order linking customer Globex is being saved and another user edits Globex
- **THEN** the edit of Globex saves without waiting for the order
