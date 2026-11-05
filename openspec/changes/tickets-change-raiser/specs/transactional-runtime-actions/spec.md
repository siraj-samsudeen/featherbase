# Transactional Runtime Actions

## ADDED Requirements

### Requirement: An action can ask who is enabled

An app's action or read SHALL be able to ask which of some people are enabled, as far as the calling person may see them. A built-in account, a person merged into another, and a service account are never enabled people.

#### Scenario: A person who has left is not enabled

- **WHEN** an action asks about a person who has been disabled and one who has not
- **THEN** only the person who has not been disabled is answered

### Requirement: A System Manager's action can hand over one of the app's own rows

An action SHALL be able to make an enabled person the creator of one row of a Table the app owns, so that a grant on rows a person created follows the row. The host SHALL refuse this when the calling person does not hold the System Manager role, and for a Table the app does not own.

#### Scenario: A row handed over follows its new creator

- **WHEN** a System Manager's action hands a row of the app's own Table to a person
- **THEN** that person reaches it through a grant on rows they created, and its earlier creator no longer does

#### Scenario: Anyone else is refused

- **WHEN** the action runs for someone who does not hold the System Manager role
- **THEN** the row stays with its creator
