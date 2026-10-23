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
person themselves created, rather than every row. This holds for the
table's list, its form, and any counts of it.

#### Scenario: Limited to your own rows

- **WHEN** a user holds a write grant limited to rows they created, and opens
  a row created by someone else
- **THEN** they can't edit it

### Requirement: Access can be narrowed to specific rows

Beyond what a role grants, a person's access to a table's list, its form,
and any counts of it SHALL be narrowable to a chosen set of its rows, or to
rows that reference a chosen set of rows in another table. This narrowing
SHALL NOT apply to a System Manager.

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
requires can see or change it. In the table's list and form, and when a
single row is opened, it's omitted from what other roles see, and a write to
it from them is silently dropped rather than saved.

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

### Requirement: The screen shows only what a person can use

After signing in, a person SHALL see only the tools they can use, decided by
the server from their current roles and grants. Someone whose only access is
the Sales Target report SHALL get a bare screen — the report, their name,
their own sign-in methods and sign-out — with no administration menu, and
without the page asking for anything they would be refused. Someone with no
role of use at all SHALL get a plain page saying they have no access yet and
to ask their administrator, with sign-out; until they are given a role they
cannot manage their own sign-in methods. Building tables and importing data
SHALL be offered only to System Managers, as are changing a table's columns and
merging tables; the New button on a table's list is offered only where the
person may create rows. Access tokens stay available to everyone in the administration,
because they are self-service. A table list SHALL name only the tables the
person can read. A grant given to everyone (the built-in All role, which apps
use for their own tables) makes its table appear in lists but does not by itself
open the administration to someone. Someone with no grant of their own, only a row shared
with them, SHALL be told how such rows reach them rather than shown an empty
screen.

#### Scenario: A report-only person never meets the administration menu

- **WHEN** someone holding only the Sales Target Viewer role opens an
  administration address
- **THEN** they are taken to their report, and no administration menu or
  refused request appears

#### Scenario: A person with no access is told so

- **WHEN** someone with no roles of use signs in
- **THEN** they see that they have no access yet, who to ask, and a way to
  sign out

#### Scenario: A management address typed by someone else

- **WHEN** someone who is not a System Manager types the address for building
  a table, importing data, editing columns or merging
- **THEN** they land on the administration home instead
