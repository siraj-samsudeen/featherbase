# Budgets Month Close

## Purpose

Each month the financial controller closes the books from a trial balance and adds manual
lines, called adjustments: provisions, reallocations and the like. A close is kept as it was
published, and each adjustment is followed until SAP has posted it.

## ADDED Requirements

### Requirement: A published close is kept as it was

Publishing a close SHALL record who published it and when. Adjustments SHALL not be added to
it or changed after that. A later publication of the same month SHALL be a new version, which
replaces the one before.

#### Scenario: Nothing is added to a published close

```gherkin
Given the close of October has a provision of 42,500 for Hilltop
When a Budget Editor publishes the close
Then the close says who published it
When the Budget Editor adds another adjustment to it
Then they are refused
```

#### Scenario: Republishing makes a second version

```gherkin
Given the close of October is published
When a Budget Editor makes a new version of it
Then October has a version 2 that is open
And version 1 is marked as replaced
```

### Requirement: An adjustment is followed until SAP has posted it

Each adjustment SHALL show what remains of it. Matching it to an SAP document SHALL reduce what
remains, and it SHALL be settled when nothing remains. A match SHALL settle no more than what
remains. Matching SHALL stay possible after the close is published.

#### Scenario: A provision is matched in two parts

```gherkin
Given the close of October has a provision of 42,500 for Hilltop
And the close is published
When a Budget Editor matches 40,000 of it to an SAP document
Then 2,500 remains and the provision is still open
When the Budget Editor matches the last 2,500 to another SAP document
Then nothing remains and the provision is posted in SAP
```

### Requirement: An adjustment takes its line from its account

An adjustment SHALL be reported on the P&L line of its account. An account with no P&L line
SHALL not be used for one.

#### Scenario: An account that is not classified yet

```gherkin
Given the account "Pallet Purchases" has no P&L line
When a Budget Editor adds an adjustment on that account for Hilltop
Then they are refused, and told to classify the account first
```
