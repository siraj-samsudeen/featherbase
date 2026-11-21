# Budgets Close Rules

## Purpose

The close is worked out from rules the financial controller keeps: the P&L line each account
belongs to, and the lines that add up to each published line. A rule can
be changed at any time without approval, and every change is kept.

## ADDED Requirements

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
