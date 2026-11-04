# Trusted runtime packages

## ADDED Requirements

### Requirement: An app knows the roles of the person it acts for
An app's actions and reads SHALL be told which roles the signed-in person holds, so an app can let a role take a
step. They SHALL learn only that person's own roles, never another person's.

#### Scenario: An app sees the caller's own roles

```gherkin
Given a person who holds the "Data Quality Verifier" role
When that person runs an app action
Then the action is told the person holds "Data Quality Verifier"
```
