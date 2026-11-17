# Trusted Runtime Packages

## ADDED Requirements

### Requirement: A save rule knows the writer's roles
An app's save rule (validator) SHALL be told the roles the writer holds, read fresh for that save, so the rule can treat writers differently.

#### Scenario: The save rule sees the roles

- **WHEN** someone holding Team Report Manager saves a row of a Dash Table
- **THEN** Dash's save rule is told they hold Team Report Manager
