# Transactional runtime actions

## ADDED Requirements

### Requirement: An action or read counts rows as its caller
An app's action or read SHALL count the rows of a Table it may read that match a filter, as its caller: rows
the caller may not read SHALL NOT be counted, and a linked Table the caller may not read at all SHALL give no
count rather than zero.

#### Scenario: An app counts only what its caller reads

```gherkin
Given a linked Table "Buying Desk" with 3 rows, and a person who may not read it
When the app counts the rows of "Buying Desk" for that person
Then there is no count
And for a person who reads it, the count is 3
```
