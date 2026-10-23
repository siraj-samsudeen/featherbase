# Spec Delta

## MODIFIED Requirements

### Requirement: Roles decide what's possible

Every user SHALL hold one or more roles, and what they can do on a table
SHALL come from what those roles are granted there. A System Manager can do
anything on any table, even one with no grants set up for it yet, except
write to the records only the platform writes.

#### Scenario: A fresh table needs no setup

- **WHEN** a System Manager opens a table that has no permissions configured
  for it at all
- **THEN** they can read, create, edit and delete its rows

## ADDED Requirements

### Requirement: The platform's own records cannot be forged or erased

Records the platform keeps about what happened, such as who signed in, what
changed and which jobs ran, SHALL be written only by the platform itself. No
one, a System Manager, the Administrator or an access token included, SHALL
be able to add, change or remove them, by hand, by import or by changing
their columns. Anyone allowed to read them still can.

#### Scenario: An administrator tries to add a sign-in

- **WHEN** a System Manager tries to add a sign-in to the activity record
- **THEN** it is refused, and the activity record is unchanged

#### Scenario: Signing in is still recorded

- **WHEN** the user signs in
- **THEN** the sign-in appears in the activity record, and a System Manager
  can read it there but sees no way to edit or delete it
