# Tickets assignees

## Purpose
Support assigns tickets to the people who work them. Who may be assigned a ticket is set apart from who has support rights, so a person who only works the tickets assigned to them doesn't also get to triage every ticket and open its details (#964).

## Requirements

### Requirement: People can be assignable without support rights
Tickets SHALL have an `assignees` setting, a list of people. Support's assign picker SHALL offer those people as well as everyone it already offered: support users, verification admins, fulfillment admins and approvers. Being listed SHALL give no support rights. An empty or missing setting SHALL change nothing.

#### Scenario: An assignable person is offered without support rights

```gherkin
Given Colleague is listed only as someone tickets can be assigned to
When support assigns Anjali's ticket to Colleague
Then the assign picker offers Colleague and Support
And Colleague has no support rights
```

#### Scenario: With no one listed, the picker is as before

```gherkin
Given no one is listed as someone tickets can be assigned to
Then the assign picker offers Support and not Colleague
```
