# Tickets type transitions

## ADDED Requirements

### Requirement: A ticket type's actions are the only way it moves
A ticket type MAY list transitions: an action that moves a ticket from one of its states to another. When it does,
the ticket page SHALL offer the viewer only the actions they may take from the ticket's current state, and the
server SHALL refuse every other change of state. A type that lists no transitions SHALL work as before.

#### Scenario: The assignee confirms a fix plan

```gherkin
Given a Data Quality Issue type whose assignee confirms a raised issue with what will be fixed, where, and a target date
And Anjali raised a Data Quality Issue for SAP, assigned to Bala
When Bala opens that ticket
Then Bala is offered to confirm it, and Anjali is not
When Bala confirms it without a target date
Then the confirmation is refused as missing the target date
When Bala confirms it with what will be fixed, where, and a target date
Then the ticket is in "Fix planned"
```

#### Scenario: A move the type does not list is refused

```gherkin
Given a Data Quality Issue type whose assignee confirms a raised issue with what will be fixed, where, and a target date
And Anjali raised a Data Quality Issue for SAP, assigned to Bala
When support sets the ticket's state to "Closed" directly
Then the change is refused and the ticket stays in "Raised"
```

### Requirement: Each action is taken only by the people it names
A transition SHALL name who may take it: the ticket's assignee, its raiser, anyone involved in the ticket, or the
holders of a role. Two transitions with the same action from the same state SHALL let either kind of person take it.

#### Scenario: The raiser or a verifier verifies the fix

```gherkin
Given a Data Quality Issue that Bala has marked fixed
Then Anjali and a Data Quality verifier may verify it, and Bala may not
When the verifier verifies it
Then the ticket is closed and leaves the open queue
```

### Requirement: History says who took which action
Taking an action SHALL record who took it, from which state to which, and the values they entered. The shared
progress SHALL say which action was taken.

#### Scenario: A question and its answer are kept

```gherkin
Given Anjali raised a Data Quality Issue for SAP, assigned to Bala
When Bala asks "Which plant?" and Anjali answers "Plant 1100"
Then the ticket is back in "Raised" and its history shows Bala asking and Anjali answering, with both texts
```

### Requirement: A ticket type chooses who reads its details
A ticket's details and history SHALL be readable by everyone who can see the ticket, unless its type is made
private. A private type's details SHALL be read only by the raiser and support; everyone else sees only which
actions were taken. Built-in types, such as access requests, are private.

#### Scenario: Data Quality Issue details are open to everyone

```gherkin
Given Anjali raised a Data Quality Issue for SAP, assigned to Bala
When Bala asks "Which plant?" and Anjali answers "Plant 1100"
Then a colleague reads the question and "Plant 1100"
```

#### Scenario: A private type shows others only the actions

```gherkin
Given the Data Quality Issue type is private
And Anjali raised a Data Quality Issue for SAP, assigned to Bala
When Bala asks "Which plant?" and Anjali answers "Plant 1100"
Then a colleague sees that a question was asked and answered, but not "Plant 1100"
```
