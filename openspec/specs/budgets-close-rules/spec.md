# budgets-close-rules Specification

## Purpose
The close is worked out from rules the financial controller keeps: the P&L line each account
belongs to, the lines that add up to each published line, and each store's area. A rule can
be changed at any time without approval, and every change is kept.

## Requirements

### Requirement: Subtotals are worked out from the lines

The P&L SHALL be its lines in order. A subtotal SHALL be worked out from the lines above it and
never typed, so it always agrees with them.

#### Scenario: Store EBITDA follows a changed line

```gherkin
Given a P&L of Scan Margin, Manpower Cost and Store EBITDA
And Hilltop has a Scan Margin of 100 and a Manpower Cost of 30
Then Hilltop's Store EBITDA is 70
When Manpower Cost becomes 40
Then Hilltop's Store EBITDA is 60
```

### Requirement: Several accounts are classified together

A Budget Editor SHALL be able to give several accounts their P&L line in one step. Each
change SHALL be kept in the account's history with who made it.

#### Scenario: Two accounts get the same line

```gherkin
Given the accounts "Staff Tea And Snacks" and "Staff Uniform"
When a Budget Editor gives both the line Salaries in one step
Then both accounts are on Salaries
And the history of "Staff Uniform" says who changed its line
```

### Requirement: A store's area is kept from a date

A store's area SHALL be recorded from the day it applies. Recording a new area SHALL end the
one before it on the day before.

#### Scenario: A second floor opens

```gherkin
Given Hilltop has an area of 24,500 sq ft from 01-Apr-2026
When a Budget Editor records 26,000 sq ft from 15-Oct-2026
Then the 24,500 sq ft area ends on 14-Oct-2026
And Hilltop's area from 15-Oct-2026 is 26,000 sq ft
```
