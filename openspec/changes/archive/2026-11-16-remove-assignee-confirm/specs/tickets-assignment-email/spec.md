## MODIFIED Requirements

### Requirement: Support assigns from the ticket's header, after confirming
Support SHALL assign in the ticket's header, from a picker of Unassigned and the people tickets can be assigned to. Picking SHALL save nothing: a confirm row SHALL ask "Assign to <person> and email them?" or "Assign to yourself?" with Assign and Cancel, or "Remove the assignee?" with Remove and Cancel. Cancel SHALL restore the current assignee; Assign and Remove SHALL save through the ticket's edit, so the mail rules above apply.

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

#### Scenario: Removing the assignee asks with Remove

```gherkin
Given Anjali has raised a ticket that support has assigned to Colleague
When support picks Unassigned on the ticket screen
Then the ticket screen asks "Remove the assignee?" with Remove and Cancel
And when support removes the assignee, the ticket screen shows the ticket as Unassigned
```
