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

### Requirement: A row with comments, history, attachments or shares can't be deleted

Deleting a row SHALL be refused while it has comments, change history,
attachments or shares, so no one's work is ever lost with it. The user is
told what is holding it and how many of each.

#### Scenario: Delete a customer someone has commented on

- **WHEN** a user tries to delete the customer "Acme", which has two comments
- **THEN** the deletion is refused, saying it has 2 comments
- **AND** the customer and its comments remain exactly as they were

### Requirement: A refused delete offers to retire the row instead

When a delete is refused because the row has comments, history, attachments or shares, or
because another row links to it, the refusal SHALL offer to retire the row instead, wherever the
Table allows retiring and the user may.

#### Scenario: A plant with history

- **WHEN** a user tries to delete the plant "Sample plant", which has history
- **THEN** the deletion is refused, saying why
- **AND** the user is offered to retire "Sample plant" instead

### Requirement: A System Manager can delete a row permanently

A System Manager SHALL be able to delete a row permanently even when it has comments, history,
attachments or shares; those go with it. A reason and a typed confirmation are required. Anyone
else keeps the rule that such a row cannot be deleted.

#### Scenario: A setup mistake removed

- **WHEN** a System Manager deletes the Business Unit "Test BU", which has history, giving the
  reason "Created by mistake during setup" and confirming
- **THEN** "Test BU" and its history are gone

#### Scenario: An editor still cannot

- **WHEN** a user who may delete Business Units, but is not a System Manager, deletes "Test BU"
- **THEN** it is refused as before, and Retire is offered instead

### Requirement: Rows that depend on it are shown first

Before a permanent delete, the System Manager SHALL see every row that still points at the rows
being deleted, grouped by table with counts and readable names, and choose either to delete them
too or to clear their link. Either way, no row is left pointing at a row that is gone.

#### Scenario: Stores of a deleted Business Unit

- **WHEN** a System Manager starts to delete "Test BU", and the stores "Store A" and "Store B"
  point at it
- **THEN** they see "Stores: 2 — Store A, Store B" before confirming
- **AND** choosing to delete them too removes all three, while choosing to clear the link keeps
  both stores with no Business Unit

### Requirement: A dependent row that can be neither removed nor unlinked holds the delete

When a dependent row can be neither deleted nor have its link cleared, such as a required link
from a platform table, the permanent delete SHALL wait, and the System Manager is shown those rows
with links to them.

#### Scenario: A required link from a protected table

- **WHEN** a platform row must point at "Test BU"
- **THEN** the delete cannot be confirmed, and that row is listed with a link to it

#### Scenario: Someone's access is limited to it

- **WHEN** a person's access is limited to "Test BU"
- **THEN** the delete cannot be confirmed until that limit is changed, so no one comes to see more
  than they did

### Requirement: Every permanently deleted row leaves a deletion record

Each row a permanent delete removes, those removed with it included, SHALL leave a record of who
deleted it, when, why, and what the row held.

#### Scenario: The record of a cascade

- **WHEN** a System Manager deletes "Test BU" together with its two stores
- **THEN** the audit log holds three deletion records, each with the reason and the row as it was

### Requirement: Many rows, or one import's rows, at once

A System Manager SHALL be able to delete permanently a selection of rows, or every row one import
added, with the same preview and confirmation.

#### Scenario: Clearing a rehearsal import

- **WHEN** a System Manager deletes permanently the rows a rehearsal import added
- **THEN** the preview lists those rows, and confirming removes them all

### Requirement: A permanent delete is all or nothing

A permanent delete SHALL remove everything it previewed, or, if any part fails, nothing at all.

#### Scenario: One dependent cannot go

- **WHEN** one of the stores being removed with "Test BU" refuses to be deleted
- **THEN** nothing is deleted, "Test BU" and both stores remain

### Requirement: Platform tables are never deleted permanently

Permanent deletion SHALL NOT be offered or allowed on the platform's own tables, a person's
sign-in records, settings tables, tables read from an outside database, tables of private work,
or rows locked by the instance's settings.

#### Scenario: A person record

- **WHEN** a System Manager tries to delete a person permanently
- **THEN** it is refused
