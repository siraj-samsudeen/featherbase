## ADDED Requirements

### Requirement: People configured for Tickets are offered before they have used it
Support's assign picker SHALL offer, by name, everyone the Tickets settings name for assignment, including a person who has never used Tickets. Someone the settings don't name SHALL be shown to a viewer who can't read Person no more than before.

#### Scenario: Someone listed before they have used Tickets is offered

```gherkin
Given Colleague is listed as someone tickets can be assigned to before using Tickets
Then the assign picker offers Colleague by name
```
