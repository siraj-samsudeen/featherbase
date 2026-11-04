# Trusted runtime packages

## ADDED Requirements

### Requirement: An app knows the roles of the person it acts for
An app's actions and reads SHALL be told which roles the signed-in person holds, so an app can let a role take a
step. They SHALL learn only that person's own roles, never another person's.

#### Scenario: Tickets offers a step to the holder of a role

```gherkin
Given a Data Quality Issue that Bala has marked fixed
And a person who holds the "Data Quality Verifier" role and is not involved in the ticket
When that person opens the ticket in Tickets
Then Tickets offers that person the verification
```
