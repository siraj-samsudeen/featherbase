## MODIFIED Requirements

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

#### Scenario: A date change reads as days

- **WHEN** a row's start date is moved from 23-Oct-2026 to 24-Oct-2026
- **THEN** the timeline shows the change as 23-Oct-2026 → 24-Oct-2026, with no time or zone
