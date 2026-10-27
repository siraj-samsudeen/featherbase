## ADDED Requirements

### Requirement: Sensitive columns stay out of webhooks and rule emails

A webhook call and an email sent by a rule SHALL never carry a sensitive column of the row, or of the lines inside it, since the people and systems they reach are outside any role.

#### Scenario: A salary in a webhook

- **WHEN** a row with a sensitive salary column is saved and a webhook is set to call another system for it
- **THEN** the other system gets the row without the salary

#### Scenario: A salary in a rule's message

- **WHEN** a rule's message names the sensitive salary column of the row it emails about
- **THEN** that part of the message is left empty
