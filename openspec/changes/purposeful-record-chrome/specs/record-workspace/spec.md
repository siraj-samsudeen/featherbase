# Record Workspace

## ADDED Requirements

### Requirement: Concentrate on the current row

The user SHALL be able to move between a row's work, related navigation, collaboration and activity without losing unfinished edits. Occasional record operations SHALL remain reachable separately from primary work.

#### Scenario: Unfinished work survives consulting activity

```gherkin
Given the user can edit the Plant row for Tenkasi
When the user changes its name and consults its activity before returning to work
Then the unfinished name is still present and can be saved
And the row's print and related navigation remain reachable
```

### Requirement: Distinguish row work from Table administration

The list SHALL distinguish ordinary work and alternate views from Table administration. Existing bulk operations SHALL be offered only while rows are selected, and clearing selection SHALL withdraw them without changing the rows.

#### Scenario: Selection reveals operations on rows, not the Table

```gherkin
Given the user manages the Plant Table containing Tenkasi
When the user selects Tenkasi in its list
Then the selection offers deletion of rows separately from deletion of the Table
And clearing the selection removes the row operations without changing Tenkasi
```

#### Scenario: Ordinary readers do not get Table administration

```gherkin
Given the user can only read the Plant row for Tenkasi
When the user consults its list views and related navigation
Then the list does not offer Table administration
And Tenkasi remains readable
```
