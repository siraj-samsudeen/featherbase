# Permissions and Roles

## Purpose

What a person can see and do in Featherbase is decided by the roles they
hold, table by table, down to individual rows and columns when that's not
enough.

## Requirements

### Requirement: Roles decide what's possible

Every user SHALL hold one or more roles, and what they can do on a table
SHALL come from what those roles are granted there. A System Manager can do
anything on any table, even one with no grants set up for it yet.

#### Scenario: A fresh table needs no setup

- **WHEN** a System Manager opens a table that has no permissions configured
  for it at all
- **THEN** they can read, create, edit and delete its rows

### Requirement: A role's grant on a table

For each table, a role SHALL be granted its own combination of reading,
creating, editing and deleting rows, and — for rows that go through a formal
submit step — submitting, cancelling and amending them. A person without a
grant for an action on a table SHALL be refused that action there.

#### Scenario: No delete grant

- **WHEN** a user whose roles are granted read and write on a table, but not
  delete, tries to delete one of its rows
- **THEN** the deletion is refused

### Requirement: A grant can be limited to rows someone created

A role's grant on a table SHALL optionally apply only to the rows the
person themselves created, rather than every row.

#### Scenario: Limited to your own rows

- **WHEN** a user holds a write grant limited to rows they created, and opens
  a row created by someone else
- **THEN** they can't edit it

### Requirement: Access can be narrowed to specific rows

Beyond what a role grants, a person's access to a table SHALL be narrowable
to a chosen set of its rows, or to rows that reference a chosen set of rows
in another table. This narrowing SHALL NOT apply to a System Manager.

#### Scenario: Narrowed to one region's rows

- **WHEN** a user's access to a Customers table is narrowed to customers in
  one region, and they open the full customer list
- **THEN** they see only that region's customers, and any table with rows
  referencing customers outside that region hides those rows too

### Requirement: A single row can be shared beyond its role grants

A specific row SHALL be shareable with a chosen person, giving them reading,
editing, or the ability to share it onward, even if their roles alone
wouldn't grant that on the table it belongs to.

#### Scenario: Shared with someone outside the role grant

- **WHEN** a row is shared for editing with a user who has no write grant on
  its table
- **THEN** that user can edit that one row, and no others on the table

### Requirement: A column can be marked sensitive

A column SHALL be markable so that only roles with the deeper access it
requires can see or change it; everyone else's view of that row simply omits
it, and a write to it from anyone else is silently dropped rather than
saved.

#### Scenario: A sensitive column is hidden

- **WHEN** a user without the deeper access opens a row that has a sensitive
  column
- **THEN** the column is absent from what they see, not shown blank or
  masked

### Requirement: A refusal explains itself

When a table, a row, or an action on it is refused, Featherbase SHALL show
why in place of the list or form, rather than showing nothing or an empty
list.

#### Scenario: Refused list

- **WHEN** a user without a read grant opens a table's list
- **THEN** they see a message explaining they can't read it, not an empty
  list
