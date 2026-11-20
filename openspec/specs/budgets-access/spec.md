# budgets-access Specification

## Purpose
Budgets holds the company's budgets and the working of its monthly close. Only the people
finance names may see any of it.

## Requirements

### Requirement: Only Budgets people see Budgets

Budgets SHALL be open only to a Budget Editor or a Budget Viewer. Anyone else, an administrator
of the instance included, SHALL see none of its figures and SHALL not be offered the app.

#### Scenario: An administrator is not a Budgets person

```gherkin
Given the FY27 Original budget holds a figure for Hilltop
When an administrator who is not a Budgets person asks for the budget's figures
Then they are refused
And Budgets is not among the apps they can open
```

### Requirement: A viewer reads everything and changes nothing

A Budget Viewer SHALL read every budget, close and rule. Only a Budget Editor SHALL change one.

#### Scenario: A viewer cannot approve a budget

```gherkin
Given the FY27 Original budget is a draft
When a Budget Viewer reads its figures
Then they see the figure for Hilltop
When the Budget Viewer tries to approve the budget
Then they are refused
And the budget is still a draft
```
