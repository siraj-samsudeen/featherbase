# List view

## ADDED Requirements

### Requirement: Filter for blank values
A list SHALL filter a column for **is blank** (no value, or empty text) and **is not blank** (any other
value), with no value to type.

#### Scenario: Is blank finds empty and empty-text values

```gherkin
Given a table with a row whose name is empty, a row whose name is empty text and a row named "Asha"
When the user filters name is blank
Then the list shows the first two rows
And name is not blank shows only "Asha"
```
