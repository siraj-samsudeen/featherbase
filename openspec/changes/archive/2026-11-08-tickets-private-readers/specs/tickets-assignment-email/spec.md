# Tickets assignment email

## REMOVED Requirements

### Requirement: The email holds only what the assignee may read

**Reason**: A private ticket's assignee now reads its description (#925), so its scenario of a private description left out of the email no longer happens.

**Migration**: Replaced by "The email holds what the assignee reads on the ticket".

## ADDED Requirements

### Requirement: The email holds what the assignee reads on the ticket
The email SHALL give the ticket's title, who assigned it and a link that opens the ticket. It SHALL include the ticket's description only if the assignee may read it on the ticket, and otherwise SHALL say it is left out. A private ticket's assignee reads its description.

#### Scenario: A private ticket's assignee gets its description

```gherkin
Given Anjali has raised a ticket that support can assign
When support assigns Anjali's ticket to Colleague
Then the email to Colleague names the ticket, who assigned it and a link to it
And the email to Colleague includes the description
```

#### Scenario: Someone who may read the description gets it

```gherkin
Given Anjali has raised a ticket that support can assign
When support assigns Anjali's ticket to Verifier
Then the email to Verifier includes the description
```
