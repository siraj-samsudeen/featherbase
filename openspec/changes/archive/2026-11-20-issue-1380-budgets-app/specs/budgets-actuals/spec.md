# Budgets Actuals

## Purpose

Actual figures stay in the company's data warehouse, where the ledger is. Budgets reads them
when a page needs them and keeps no copy, so there is one place for a figure to be right.

## ADDED Requirements

### Requirement: Actuals are read from the warehouse

Budgets SHALL read a month's actual figures from the warehouse each time they are asked for.
Where no warehouse is connected, Budgets SHALL say so and still show budgets.

#### Scenario: The warehouse is connected

```gherkin
Given the warehouse holds actual Salaries of 17,42,500 for Hilltop in October
When a Budget Viewer asks for October's actuals
Then they get 17,42,500 for Hilltop's Salaries
```

#### Scenario: No warehouse is connected

```gherkin
Given no warehouse is connected
When a Budget Viewer asks for October's actuals
Then they are told that actuals are not connected
```
