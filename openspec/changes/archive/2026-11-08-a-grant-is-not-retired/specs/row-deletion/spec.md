## MODIFIED Requirements

### Requirement: A refused delete offers to retire the row instead

When a delete is refused because the row has comments, history, attachments or shares, or
because another row links to it, the refusal SHALL offer to retire the row instead, wherever the
Table allows retiring and the user may. A refused delete of a grant SHALL instead say to untick it
in the permission matrix.

#### Scenario: A plant with history

- **WHEN** a user tries to delete the plant "Sample plant", which has history
- **THEN** the deletion is refused, saying why
- **AND** the user is offered to retire "Sample plant" instead

#### Scenario: A grant with history

- **WHEN** a System Manager deletes a role's read grant on plants from its own row, and the grant
  has history
- **THEN** the deletion is refused, saying to untick it in the permission matrix
- **AND** Retire is not offered
