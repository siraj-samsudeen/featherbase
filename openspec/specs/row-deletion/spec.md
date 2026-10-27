# Row Deletion

## Purpose

Deleting a row is permanent, so the user is asked to confirm it, and it is
refused rather than silently allowed whenever something else still depends
on that row.

## Requirements

### Requirement: Delete a row

Deleting a row SHALL require permission to delete on its Table, and the user
SHALL be asked to confirm before it happens. Deleting a row SHALL also remove
any child rows that belong only to it.

#### Scenario: Confirm and delete

- **WHEN** a permitted user confirms deleting a row that nothing else depends
  on
- **THEN** the row is removed, along with any child rows that belonged to it

### Requirement: A row still linked from elsewhere can't be deleted

If another row anywhere still refers to this one, deleting it SHALL be
refused, and the user SHALL be told which row is holding onto it.

#### Scenario: Blocked by a reference

- **WHEN** a user tries to delete a row that another row still refers to
- **THEN** the deletion is refused
- **AND** the user is told which row refers to it

### Requirement: A submitted row must be cancelled first

A row that has been submitted SHALL NOT be deleted directly; the user is
told to cancel it first.

#### Scenario: Attempt on a submitted row

- **WHEN** a user tries to delete a row that is submitted
- **THEN** the deletion is refused
- **AND** the user is told to cancel it before it can be deleted

### Requirement: A refusal changes nothing

Any refused deletion SHALL leave the row, and everything connected to it,
exactly as it was.

#### Scenario: Nothing moves after a refusal

- **WHEN** a deletion is refused because another row still links to it
- **THEN** the row and its data remain exactly as they were before the
  attempt

### Requirement: A late deletion of an app row is refused

If someone else has changed a row supplied by an installed app since the user opened it, deleting that row SHALL be refused rather than removing the newer version.

#### Scenario: Someone else changed the app row first

- **WHEN** the user tries to delete an installed app's row that another person changed after the user opened it
- **THEN** the deletion is refused
- **AND** the newer version remains unchanged

### Requirement: Nested rows and settings are deleted only through what holds them

A nested row — one line inside another row, such as an item on an order —
SHALL NOT be deleted on its own; it goes when its parent row drops it or is
deleted. A settings table's values SHALL NOT be deleted as if they were a
row.

#### Scenario: Delete one line of an order directly

- **WHEN** a user tries to delete a single line of an order on its own
- **THEN** the deletion is refused and the order keeps that line

#### Scenario: Delete a settings table's row

- **WHEN** a user tries to delete the one row of a settings table
- **THEN** the deletion is refused, naming the table
