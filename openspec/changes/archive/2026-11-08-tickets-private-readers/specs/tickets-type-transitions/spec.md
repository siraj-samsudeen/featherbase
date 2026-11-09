# Tickets type transitions

## MODIFIED Requirements

### Requirement: A ticket type chooses who reads its details
A ticket's details and history SHALL be readable by everyone who can see the ticket, unless its type is made
private. A private type's details SHALL be read by the raiser, support and the people the ticket names (below);
its full history by support only; and everyone else sees only which actions were taken. Built-in types, such as
access requests, are private. A ticket raised while its type was private stays private until support opens it,
with its history.

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

## ADDED Requirements

### Requirement: A private ticket's assignee and raised-for person read its details
On a private ticket, its current assignee and the person its type's `raised_for` field names SHALL read its
details as its raiser does. An assignee who is replaced, or a person no longer raised for, SHALL stop reading them.

#### Scenario: The assignee and the person it is raised for read a private ticket

```gherkin
Given the Data Quality Issue type is private
And Pat raised a Data Quality Issue for SAP on behalf of Ravi, and support assigned it to Colleague
Then Colleague and Ravi read the ticket's details, but not support's history
And Anjali, who is not named on the ticket, does not read them
When support reassigns the ticket to Meera
Then Meera reads the ticket's details, and Colleague no longer does
```
