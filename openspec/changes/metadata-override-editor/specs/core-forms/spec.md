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

### Requirement: One adjustment for each setting

A Table, column and setting SHALL have at most one adjustment; empty column scopes all mean the whole Table. A duplicate creation or move SHALL be refused with guidance to edit the existing adjustment, while editing that same adjustment remains allowed.

#### Scenario: A second adjustment cannot compete with the first

```gherkin
Given the user has saved an adjustment that hides "floor"
When the user tries to add the same adjustment again
Then the user is told to edit the existing adjustment
And only the original adjustment is saved
```

#### Scenario: A move cannot replace another adjustment

```gherkin
Given the user has saved an adjustment that hides "floor"
When the user tries to move it to a setting that already has an adjustment
Then the user is told to edit the existing adjustment
And the original adjustment stays on its previous Table
```

### Requirement: A moved adjustment leaves no old effect

Saving an adjustment for a different Table SHALL remove its effect from the previous Table and apply it to the new Table, including when those Tables have already been viewed.

#### Scenario: Only the new target keeps the adjustment

```gherkin
Given the user has saved an adjustment that hides "floor"
When the user moves the adjustment to another Table
Then the old Table no longer hides its column
And the new Table hides the selected column
```
