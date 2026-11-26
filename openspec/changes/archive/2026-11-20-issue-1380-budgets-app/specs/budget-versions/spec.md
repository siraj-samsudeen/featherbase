# Budget Versions

## Purpose

A budget changes during the year. Each change is kept as a version, so the team can always say
which budget a month is measured against and what it was before.

## ADDED Requirements

### Requirement: The budget for a month is its latest approved version

The budget for a month SHALL be the most recently approved version that covers that month. A
draft SHALL never be the budget.

#### Scenario: A revision takes over from its first month

```gherkin
Given the FY27 Original budget covers April to March and is approved
And FY27 Revision 1 covers October to March and is approved after it
Then the budget for September is FY27 Original
And the budget for October is FY27 Revision 1
```

#### Scenario: A draft revision changes nothing yet

```gherkin
Given the FY27 Original budget covers April to March and is approved
And FY27 Revision 1 covers October to March and is still a draft
Then the budget for October is FY27 Original
```

### Requirement: An approved budget is revised, not edited

Approving a budget SHALL record who approved it and when. Its figures SHALL not change after
that. A revision SHALL start as a draft showing the approved figures for the months it covers, and
SHALL hold only the figures it changes.

#### Scenario: A figure cannot be changed after approval

```gherkin
Given the FY27 Original budget holds 18,40,000 for Hilltop's Manpower Cost in October
When a Budget Editor approves the budget
Then the budget says who approved it
When the Budget Editor changes that figure to 19,00,000
Then they are refused
```

#### Scenario: A revision starts from the approved figures

```gherkin
Given the FY27 Original budget holds 18,40,000 for Hilltop's Manpower Cost in October
And the budget is approved
When a Budget Editor revises it for October to March as FY27 Revision 1
Then FY27 Revision 1 is a draft
And it shows 18,40,000 for Hilltop's Manpower Cost in October, held on FY27 Original
```

### Requirement: Figures brought in together are saved together

Figures brought in from a spreadsheet SHALL all be saved, or none. A figure already in the
draft SHALL be replaced, not added twice.

#### Scenario: One bad figure keeps the whole block out

```gherkin
Given the FY27 Original budget is a draft
When a Budget Editor brings in a figure for Hilltop and a figure for a subtotal line together
Then they are refused
And the budget holds neither figure
```

#### Scenario: Bringing a figure in again replaces it

```gherkin
Given the FY27 Original budget holds 18,40,000 for Hilltop's Manpower Cost in October
When a Budget Editor brings in 19,00,000 for Hilltop's Manpower Cost in October
Then the budget holds one figure for it, 19,00,000
```
