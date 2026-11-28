# Scoped App Reads

## ADDED Requirements

### Requirement: A Table about places is read within each person's places
A read-only copy (by its dataset's filters) or an app's own Table (by `scopedTables`) SHALL be read only within each person's places, by the dataset rule, on every read path: lists, counts, single rows, Sub-table rows and live updates. A row the person wrote SHALL always be theirs. A System Manager SHALL NOT be narrowed.

#### Scenario: A section's answers, and no other

```gherkin
Given a review Table holds an answer at store "9001" for subcategory "000000001" and one for subcategory "000000004"
And the reader's only place is store "9001" with subcategory "000000001"
When the reader lists the review Table
Then it answers the first answer only
And opening the second answer is refused
```

#### Scenario: A place the Table cannot apply adds nothing

```gherkin
Given a reader's place names a filter the Table does not map
When the reader lists the Table
Then that place adds no rows
```

#### Scenario: Someone with no places sees only what they wrote

```gherkin
Given the org chart gives the reader no place
When the reader saves an answer and lists the review Table
Then the list holds that answer only
```

#### Scenario: A row outside one's places is not changed

```gherkin
Given the reader's only place is store "9001"
When the reader changes an answer at store "9002"
Then the change is refused
```

## REMOVED Requirements

### Requirement: An app's own Tables can be read within the reader's places
**Reason**: Replaced by "A Table about places is read within each person's places", which applies on every read path, not only inside an app's own reads; a plain Table read narrows by any column, so the declared-key rule is gone.
**Migration**: An app reads its scoped Tables through the ordinary reads (Forecasting 0.14.0 does).

### Requirement: A validator reads its app's read-only copies whole
**Reason**: With every read kept to the reader's places, a validator reads a copy as the person saving, like any read.
**Migration**: None; no app depended on it beyond Forecasting, which checks the person's own lines.
