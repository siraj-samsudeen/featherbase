# Feather Ask

## ADDED Requirements

### Requirement: Answers come from every app

Ask SHALL answer through an agent: an AI model that looks things up step by step. It SHALL look in
any app installed on the instance, without the user saying which app or Table holds the answer.

#### Scenario: Open tickets are counted without naming the app

- **GIVEN** the user is Selvi, who has 3 open tickets in the Tickets app
- **WHEN** the user asks "How many open tickets do I have?"
- **THEN** the answer says 3

### Requirement: An answer never shows what the person may not read

Every lookup behind an answer SHALL run as the person who asked, so an answer can hold only what
they could open themselves.

#### Scenario: Another person's tickets stay hidden

- **GIVEN** Selvi has 3 open tickets and the user is Ravi, who has none
- **WHEN** the user asks "How many open tickets do I have?"
- **THEN** the answer says there are none, and names nothing of Selvi's

### Requirement: Ask only reads

Asking SHALL never add, change or delete anything in the person's data.

#### Scenario: Asking to close a ticket changes nothing

- **GIVEN** the user is Selvi, who has 3 open tickets
- **WHEN** the user asks Ask to close the oldest one
- **THEN** the answer says Ask can only read, and all 3 stay open

### Requirement: A question that cannot be answered says why

When the agent cannot find an answer within its steps, the answer SHALL say it could not, and give
the reason when a lookup was refused.

#### Scenario: Nothing found to answer with

- **GIVEN** no app on the instance holds anything about the weather
- **WHEN** the user asks "Will it rain tomorrow?"
- **THEN** the answer says it could not find an answer

#### Scenario: A refused lookup gives its reason

- **GIVEN** the user is Selvi, who may not read the sales figures
- **WHEN** the user asks "What were last month's sales?"
- **THEN** the answer says it could not answer, because she may not read the sales figures
