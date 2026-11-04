# Background and Scheduled Jobs

## ADDED Requirements

### Requirement: Keep a copied table fresh automatically

A System Manager SHALL schedule a copied table at an existing refresh cadence, change the cadence or pause it. Other people SHALL NOT administer its schedule, and nobody SHALL rename its Scheduled Job, whose name ties it to the copied table.

#### Scenario: Plants refresh hourly

```gherkin
Given the user is a System Manager with a copied Plants table
When the user schedules Plants to refresh hourly
Then Plants has one hourly schedule that the user can pause and change
```

#### Scenario: A reader cannot schedule Plants

```gherkin
Given the user can read the copied Plants table but is not a System Manager
When the user tries to schedule Plants to refresh hourly
Then the request is refused and Plants has no new schedule
```

### Requirement: Automatic copies preserve corrections and can be undone

A scheduled copy SHALL use the same refresh operation as a manual copy, preserving personal corrections and recording new source disagreements as conflicts. Each successful run SHALL be one undoable batch attributed to the system rather than a person, including when nothing changed.

#### Scenario: A correction survives an automatic copy

```gherkin
Given the user corrected plant P01 in the copied Plants table
And the source now disagrees with that correction
When the hourly Plants refresh runs
Then the correction is kept and the disagreement is recorded
And the run is one undoable system-attributed batch
```

### Requirement: See what an automatic copy found

Each run SHALL report inserted, changed, unchanged, conflicting and missing-source rows in its execution result. New conflicts SHALL notify the responsible administrators without disclosing copied values.

#### Scenario: The next copy finds no changes

```gherkin
Given the copied Plants table and its source both contain the same two plants
When the hourly Plants refresh runs
Then the execution reports two unchanged rows and no changed rows
```

#### Scenario: A new disagreement reaches an administrator

```gherkin
Given the user corrected plant P01 in the copied Plants table
And the source now disagrees with that correction
When the hourly Plants refresh runs
Then the responsible administrators receive a notice naming Plants and its new conflict count
```

### Requirement: Failed copies leave the last successful data intact

A failed copy SHALL leave data, conflict observations and import batches untouched and use the existing failure alert and retry behavior. This applies to both scheduled and manual copies, including a failure after earlier candidate rows were processed.

#### Scenario: A later plant fails validation

```gherkin
Given the copied Plants source has a valid changed plant P01 followed by an invalid plant P02
When the hourly Plants refresh runs
Then the execution fails and Plants still has its previous values
And no batch or conflict from that failed run is retained
```

### Requirement: Missing source rows are observations rather than personal edits

A successful complete source read SHALL mark absent rows as deleted at source without removing them, even when the source is empty. Those observations SHALL be undoable and SHALL NOT become personal corrections.

#### Scenario: The source has no plants left

```gherkin
Given the copied Plants table contains plant P01 and its source is now empty
When the hourly Plants refresh runs
Then plant P01 is marked deleted at source in an undoable system-attributed batch
```

### Requirement: Removed copies do not keep running

Removing a copied table or its source SHALL withdraw its refresh schedule and pending work. A stale run SHALL NOT recreate removed data.

#### Scenario: Plants is removed before its next refresh

```gherkin
Given the copied Plants table has an hourly schedule
When the user removes Plants
Then its schedule and pending refresh are removed
```
