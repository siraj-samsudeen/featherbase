## ADDED Requirements

### Requirement: A renamed row keeps its activity

Renaming a row SHALL carry along everything that belongs to it: its
comments, change history, attachments, shares, assignments and tags. A row
in another table that happens to have the same id is left alone.

#### Scenario: Comments and history after a rename

- **WHEN** a customer with a comment and an edit in its history is renamed
  from "Acme" to "Acme Corp"
- **THEN** opening "Acme Corp" shows the comment and the edit
