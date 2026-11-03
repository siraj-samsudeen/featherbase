# Dashboards and Home Pages

## MODIFIED Requirements

### Requirement: A home page groups links into cards

A home page SHALL show its links grouped into headed cards in the order
they were curated, and hide any link to a Table the viewer can't read rather
than showing it disabled. Links curated before the first named card still
sit under a heading. On System, curated groups are optional placement hints:
unplaced system Tables appear under Platform in stable name order, and each
Table appears once using its effective label, or its name when no label exists.

#### Scenario: A hidden link

- **WHEN** a home page has a card with a link to a Table one viewer can't read
- **THEN** that viewer sees the card's other links but not that one

#### Scenario: Links before the first named card

- **WHEN** a Table is added to a home page that has no named cards
- **THEN** its link appears under a heading, not in a card with no title

#### Scenario: System keeps useful groups without losing unplaced Tables

```gherkin
Given the user can manage the platform
When the user opens System
Then the existing system groups retain their order
And unplaced system Tables appear under Platform in name order
```

## ADDED Requirements

### Requirement: System grows with the platform

System SHALL include every readable system Table that can be opened independently,
including Settings Tables but not sub-tables, whenever the page is fetched.
Adding a system Table SHALL require no navigation setup.

#### Scenario: System includes all standalone system Tables

```gherkin
Given the user can manage the platform
When the user opens System
Then System contains every standalone system Table exactly once
```

#### Scenario: A new system Table appears without navigation setup

```gherkin
Given the user can manage the platform
And a new system Table has no navigation entry
When the user opens System
Then the new system Table appears under Platform
```
