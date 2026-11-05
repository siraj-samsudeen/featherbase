# Tickets raiser

## Purpose

A ticket's raiser protects the audit trail and holds the steps only the raiser may take. When the wrong one is recorded, as when a loader raised the ticket, a System Manager can correct it, and history keeps who was raiser before, who changed it and why.

## Requirements

### Requirement: A System Manager corrects who raised a ticket
A System Manager SHALL be able to name a different person as a ticket's raiser, with a reason. The new raiser SHALL then hold everything a raiser holds, and the old raiser SHALL lose it, on a private ticket too. Nothing else about the ticket SHALL change.

#### Scenario: The new raiser reads a private ticket and the old raiser no longer does

```gherkin
Given the Data Quality Issue type is private
And Anjali raised a Data Quality Issue for SAP, assigned to Bala
When a System Manager changes the raiser to Colleague because "Anjali only keyed it in"
Then Colleague reads the ticket's details, and Anjali no longer does
And the ticket is still assigned to Bala and in "Raised"
```

#### Scenario: The raiser's step moves to the new raiser

```gherkin
Given Anjali raised a Data Quality Issue for SAP, assigned to Bala
When Bala asks "Which plant?" and the ticket waits for its raiser
And a System Manager changes the raiser to Colleague because "Anjali only keyed it in"
Then Colleague may answer it, and Anjali may not
```

### Requirement: Only a System Manager changes the raiser
The server SHALL refuse a change of raiser from anyone who does not hold the System Manager role, Tickets support included, and SHALL refuse any other write of the raiser.

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

### Requirement: A change of raiser names an enabled person and a reason
The server SHALL refuse a change of raiser with no reason, to someone who is not an enabled person, to the person who is already the raiser, or based on a ticket that has changed since it was read.

#### Scenario: No reason is refused

```gherkin
Given Anjali raised a Data Quality Issue for SAP, assigned to Bala
When a System Manager changes the raiser to Colleague without a reason
Then the change of raiser is refused and Anjali is still the raiser
```

#### Scenario: A person who has left is refused

```gherkin
Given Anjali raised a Data Quality Issue for SAP, assigned to Bala
And Colleague has been disabled
When a System Manager changes the raiser to Colleague because "Anjali only keyed it in"
Then the change of raiser is refused and Anjali is still the raiser
```

### Requirement: The change of raiser reads by name in the ticket's history
A change of raiser SHALL be one event in the ticket's history, seen by whoever sees the ticket's other events. It SHALL name the old raiser, the new raiser and who changed it, say when, and give the reason.

#### Scenario: Support reads who changed the raiser and why

```gherkin
Given Anjali raised a Data Quality Issue for SAP, assigned to Bala
When a System Manager changes the raiser to Colleague because "Anjali only keyed it in"
And support opens the ticket's activity
Then the history names Anjali, Colleague and the System Manager, and gives the reason
```
