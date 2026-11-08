# Tickets assignment email

## Purpose
Assigning a ticket to someone tells them by email, once the save commits. Loading tickets through the create action sends nothing, whatever assignee a type's routing picks (#1001).

## Requirements

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

#### Scenario: Assigning on the ticket screen

```gherkin
Given Anjali has raised a ticket that support can assign
And Colleague is listed as someone tickets can be assigned to
When support assigns the ticket to Colleague on the ticket screen
Then Colleague is emailed once about the ticket
And the link in the email opens that ticket for Colleague
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

### Requirement: Support assigns from the ticket's header, after confirming
On the ticket screen, Tickets SHALL show support "Assigned to" in the ticket's header as a picker listing Unassigned and the people tickets can be assigned to. Picking SHALL save nothing: a confirm row SHALL ask "Assign to <person> and email them?", "Assign to yourself?" for the person picking, or "Remove the assignee?" for Unassigned, with Assign and Cancel. Cancel SHALL restore the current assignee. Assign SHALL save through the ticket's edit, so the mail rules above apply.

#### Scenario: Picking a person asks before anything is saved

```gherkin
Given Anjali has raised a ticket that support can assign
And Colleague is listed as someone tickets can be assigned to
When support picks Colleague as the assignee on the ticket screen
Then the ticket screen asks "Assign to Colleague and email them?"
And nobody is emailed about the ticket
```

#### Scenario: Cancelling keeps the ticket as it was

```gherkin
Given Anjali has raised a ticket that support can assign
And Colleague is listed as someone tickets can be assigned to
When support picks Colleague as the assignee on the ticket screen
And support cancels the assignment
Then the ticket screen shows the ticket as Unassigned
And nobody is emailed about the ticket
```

### Requirement: There is one way to assign, and only support has it
Anyone who is not support SHALL see a ticket's assignee as plain text. The Edit request form SHALL NOT offer an assignee; the header's picker is the only place to assign.

#### Scenario: The requester sees the assignee as text

```gherkin
Given Anjali has raised a ticket that support can assign
When Anjali opens her ticket on the ticket screen
Then Anjali sees the ticket as Unassigned, with no way to assign it
```
