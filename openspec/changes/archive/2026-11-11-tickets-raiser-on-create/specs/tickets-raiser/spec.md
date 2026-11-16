# Tickets raiser

## ADDED Requirements

### Requirement: A System Manager raises a ticket on someone's behalf
A System Manager, a service account holding that role included, SHALL be able to name an enabled person as the raiser when raising a ticket. That person SHALL hold everything a raiser holds from the start, on a private ticket too. The ticket's history SHALL say who raised it on whose behalf, and the platform's record of who created the ticket SHALL stay the caller. That event SHALL be seen by whoever sees the ticket's other events.

#### Scenario: An agent raises a private ticket for Anjali

```gherkin
Given the Data Quality Issue type is private
When an agent holding System Manager raises a Data Quality Issue for SAP on Anjali's behalf
Then Anjali is the raiser and reads the ticket's details
And the history says the agent raised it on Anjali's behalf
```

#### Scenario: The raiser's step belongs to the named raiser

```gherkin
Given an agent holding System Manager raised a Data Quality Issue for SAP on Anjali's behalf, assigned to Bala
When Bala asks "Which plant?" and the ticket waits for its raiser
Then Anjali may answer it, and the agent may not
```

### Requirement: Only a System Manager names someone else as raiser
The server SHALL refuse a new ticket that names someone other than its caller as raiser unless the caller holds the System Manager role, Tickets support included, and SHALL refuse one that names anyone but an enabled person. A refused ticket SHALL not be created.

#### Scenario: Support cannot name someone else as raiser

```gherkin
When support raises a Data Quality Issue for SAP on Anjali's behalf
Then the ticket is refused and none is created
```

#### Scenario: A person who has left cannot be named

```gherkin
Given Colleague has been disabled
When an agent holding System Manager raises a Data Quality Issue for SAP on Colleague's behalf
Then the ticket is refused and none is created
```

## MODIFIED Requirements

### Requirement: Only a System Manager changes the raiser
The server SHALL refuse a change of raiser from anyone who does not hold the System Manager role, Tickets support included, and SHALL refuse any other write of the raiser, except a System Manager naming the raiser when raising the ticket.

#### Scenario: Support is refused

```gherkin
Given Anjali raised a Data Quality Issue for SAP, assigned to Bala
When support changes the raiser to Colleague because "Anjali only keyed it in"
Then the change of raiser is refused and Anjali is still the raiser
```

#### Scenario: A direct save is refused

```gherkin
Given Anjali raised a Data Quality Issue for SAP, assigned to Bala
When a System Manager saves the ticket directly with Colleague as its raiser
Then the change of raiser is refused and Anjali is still the raiser
```
