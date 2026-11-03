# Dashboards and Home Pages

## MODIFIED Requirements

### Requirement: A home page groups links into cards

Home pages SHALL group readable links under headings in curated order, including
links before the first named card. System SHALL use groups only as placement
hints, appending unplaced Tables under Platform in stable name order. System
links SHALL use effective labels, or names if absent, without changing destinations;
a legacy override rejected by the property allowlist SHALL fall back to the name,
preserving other errors and metadata validation.

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

Whenever fetched, the reserved System Home Page SHALL link to exactly the
readable system Tables that can be opened independently, including Settings
Tables but not sub-tables, once each. Missing, duplicate or stale placement
hints SHALL NOT change this membership; adding a system Table requires no
navigation setup.

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
