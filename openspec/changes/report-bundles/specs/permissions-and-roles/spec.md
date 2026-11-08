# Permissions and Roles

## ADDED Requirements

### Requirement: An app's own assignment Tables are outside the System Manager rule
An app MAY ship Tables that say which of its own items reach whom, such as Dash's Report Access, and an ordinary role it declares MAY write them through its grants. Those Tables SHALL NOT decide what a person can do in Featherbase itself: roles, grants, data scopes and the other Tables the System Manager rule names SHALL stay writable only by a System Manager.

#### Scenario: A Report Access Manager gives a report but not a role

- **WHEN** a Report Access Manager saves a Report Access row and then tries to add a Has Role row
- **THEN** the first saves and the second is refused
