## ADDED Requirements

### Requirement: Taking a grant away keeps its history

Unticking a grant where a table's grants are set SHALL end the access on the next request, even when the grant has history, comments, attachments or shares. What the grant holds SHALL stay, with one more history entry naming who ended it and what it was. This SHALL hold only there: any other delete of a grant keeps the rule that a row with history cannot be deleted.

#### Scenario: A grant that was edited

- **WHEN** a System Manager unticks read for a role, on a grant that was edited before
- **THEN** a person holding that role is refused the table on their next request
- **AND** the grant's history can still be read, ending with who took it away and what it was

#### Scenario: Deleting the same grant any other way

- **WHEN** a System Manager deletes that grant from its own row instead
- **THEN** the delete is refused and the grant stays
