## ADDED Requirements

### Requirement: Assigning a ticket emails the person assigned
When support changes a ticket's assignee to a person through the ticket's edit, including a reassignment, Tickets SHALL queue one email to that person's address after the save commits. A save that rolls back SHALL send nothing, and a retry with the same idempotency key SHALL not send again. A mail failure SHALL leave the assignment standing.

#### Scenario: Assigning a ticket emails the assignee

```gherkin
Given Anjali has raised a ticket that support can assign
When support assigns Anjali's ticket to Colleague
Then Colleague is emailed once about the ticket
```

#### Scenario: Reassigning emails only the new assignee

```gherkin
Given Anjali has raised a ticket that support can assign
And support has assigned Anjali's ticket to Colleague
When support reassigns Anjali's ticket to Verifier
Then Verifier is emailed once about the ticket
And Colleague is emailed once about the ticket
```

### Requirement: Only a change of assignee to someone else sends mail
Tickets SHALL send nothing when a save leaves the assignee unchanged, clears the assignee, or assigns the person saving. A person with no usable email SHALL get no mail, the skip SHALL be logged, and the save SHALL still succeed. Creating a ticket SHALL send nothing, even where the ticket type's routing picks an assignee, so a load through the create action is quiet.

#### Scenario: Creating a ticket sends nothing

```gherkin
Given Anjali has raised a ticket that support can assign
Then nobody is emailed about the ticket
```

#### Scenario: Assigning yourself sends nothing

```gherkin
Given Anjali has raised a ticket that support can assign
When support assigns Anjali's ticket to themselves
Then nobody is emailed about the ticket
```

### Requirement: The email holds only what the assignee may read
The email SHALL give the ticket's title, who assigned it and a link that opens the ticket. It SHALL include the ticket's description only if the assignee may read it on the ticket, and otherwise SHALL say it is left out.

#### Scenario: A private description stays out of the email

```gherkin
Given Anjali has raised a ticket that support can assign
When support assigns Anjali's ticket to Colleague
Then the email to Colleague names the ticket, who assigned it and a link to it
And the email to Colleague leaves out the private description
```

#### Scenario: Someone who may read the description gets it

```gherkin
Given Anjali has raised a ticket that support can assign
When support assigns Anjali's ticket to Verifier
Then the email to Verifier includes the description
```
