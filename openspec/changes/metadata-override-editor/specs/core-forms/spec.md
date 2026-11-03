# Core forms

## ADDED Requirements

### Requirement: Choose an adjustment without guessing names

A user editing a metadata adjustment SHALL choose its Table, an existing column or the whole Table, and a setting permitted for that target. Boolean settings SHALL offer a yes-or-no control. New adjustments SHALL receive an ID automatically. Changing a target SHALL discard dependent selections so an old column or value cannot silently apply to the new target.

#### Scenario: Hide a column without naming the adjustment

```gherkin
Given the user can adjust a Table with a column called "floor"
When the user saves an adjustment that hides "floor"
Then the adjustment is saved without the user supplying an ID
And the saved adjustment identifies its Table, "floor" and "hidden"
And the user can open the affected Table from the saved adjustment
```

#### Scenario: A different target requires a fresh selection

```gherkin
Given the user is preparing an adjustment that hides "floor"
When the user chooses a different Table for the adjustment
Then the old column, setting and value are cleared
```

#### Scenario: Whole-Table adjustments remain available

```gherkin
Given the user can adjust a Table with a column called "floor"
When the user saves a label adjustment for the whole Table
Then the adjustment is saved for the whole Table rather than a column
```
