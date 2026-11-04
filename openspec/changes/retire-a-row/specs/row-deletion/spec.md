# Row Deletion

## ADDED Requirements

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
sign-in records, settings tables, tables read from an outside database, or rows locked by the
instance's settings.

#### Scenario: A person record

- **WHEN** a System Manager tries to delete a person permanently
- **THEN** it is refused
