# Tasker Discussions

## MODIFIED Requirements

### Requirement: Attention shows the next action

Questions directed to the user and replies awaiting their review SHALL rise to their attention list, with unread activity clearly identified. Only messages from someone else SHALL count as unread; the user's own question, reply or resolution SHALL NOT be unread for them. Questions directed to anyone SHALL remain discoverable as open team questions.

#### Scenario: Find the response needed

- **WHEN** the user has an unread question directed to them, an answer to review and a resolved question
- **THEN** the first two appear as needing attention with their different next actions
- **AND** the resolved conversation remains available without being presented as unanswered

#### Scenario: Your own question is not unread

- **WHEN** Siraj asks Shahul a question on a task
- **THEN** the question is unread for Shahul
- **AND** it is not unread for Siraj until Shahul replies
