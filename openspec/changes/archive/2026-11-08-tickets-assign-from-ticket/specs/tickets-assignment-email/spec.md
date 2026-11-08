## ADDED Requirements

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
