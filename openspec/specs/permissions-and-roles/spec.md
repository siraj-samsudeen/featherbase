# Permissions and Roles

## Purpose

What a person can see and do in Featherbase is decided by the roles they
hold, table by table, down to individual rows and columns when that's not
enough.

## Requirements

### Requirement: Roles decide what's possible

Every user SHALL hold one or more roles, and what they can do on a table
SHALL come from what those roles are granted there. A System Manager can do
anything on any table, even one with no grants set up for it yet, except
write to the records only the platform writes.

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

### Requirement: Set a table's grants in one place

A System Manager SHALL be able to see every role against a table's actions in
one place and change any role's grants there. A change SHALL apply to
everyone holding that role on their very next request, without them signing
in again.

#### Scenario: Granting read takes effect at once

- **WHEN** a System Manager gives a role read access to a table, while a
  person holding that role is signed in
- **THEN** that person's next attempt to open the table's list succeeds, and
  taking the grant away refuses the one after

### Requirement: A grant can be limited to rows someone created

A role's grant on a table SHALL optionally apply only to the rows the
person themselves created, rather than every row. This holds wherever rows
are listed, searched, opened or counted.

#### Scenario: Limited to your own rows

- **WHEN** a user holds a write grant limited to rows they created, and opens
  a row created by someone else
- **THEN** they can't edit it

### Requirement: Access can be narrowed to specific rows

Beyond what a role grants, a person's access SHALL be narrowable to a chosen
set of rows, or to rows that reference a chosen set of rows in another table.
This narrowing SHALL hold wherever rows are listed, searched, opened or
counted, and SHALL NOT apply to a System Manager.

#### Scenario: Narrowed to one region's rows

- **WHEN** a user's access to a Customers table is narrowed to customers in
  one region, and they open the full customer list
- **THEN** they see only that region's customers, and any table with rows
  referencing customers outside that region hides those rows too

#### Scenario: A row that names no customer stays visible

- **WHEN** that user opens a table of orders, some of which name no customer
  at all
- **THEN** the orders that name no customer are still listed, alongside the
  orders for customers in their region

### Requirement: A single row can be shared beyond its role grants

A System Manager SHALL be able to share a specific row with a chosen person,
giving them reading or editing, even if their roles alone wouldn't grant that
on the table it belongs to.

#### Scenario: Shared with someone outside the role grant

- **WHEN** a row is shared for editing with a user who has no write grant on
  its table
- **THEN** that user can edit that one row, and no others on the table

### Requirement: A column can be marked sensitive

A column SHALL be markable so that only roles with the deeper access it
requires can see, search or change it. Wherever rows are listed, searched,
opened, printed or returned after a save, that column is omitted for
everyone else, and a write to it from them is silently dropped rather than
saved. A sensitive column in a row's line items is treated the same way: it
shows to someone whose access to the row, or to the line items themselves,
reaches it.

#### Scenario: A sensitive column is hidden

- **WHEN** a user without the deeper access opens a row that has a sensitive
  column
- **THEN** the column is absent from what they see, not shown blank or
  masked

#### Scenario: A sensitive column in the line items

- **WHEN** a user without the deeper access opens a quote whose lines carry a
  sensitive unit cost, edits a line and saves
- **THEN** no line shows the unit cost, in the form, in the saved reply or in
  print, and the stored unit costs are unchanged

### Requirement: Stored passwords and secrets never leave the server

A stored password, secret key or token fingerprint SHALL never be shown,
searched, sorted or changed through any list, form or connected data source,
for anyone, a System Manager included. Asking for one is refused, and a write
naming one is dropped rather than saved.

#### Scenario: A System Manager opens a person

- **WHEN** a System Manager opens or lists people who have passwords
- **THEN** no password appears, and asking the list for it is refused

#### Scenario: A connected table with a password column

- **WHEN** a System Manager connects a table from another database that has
  a password or key column
- **THEN** that column is left out of the connected table, and asking for it
  is refused

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

### Requirement: The platform's own records cannot be forged or erased

Records the platform keeps about what happened, such as who signed in, what
changed and which jobs ran, SHALL be written only by the platform itself. No
one, a System Manager, the Administrator or an access token included, SHALL
be able to add, change or remove them, by hand, by import or by changing
their columns. Anyone allowed to read them still can.

#### Scenario: An administrator tries to add a sign-in

- **WHEN** a System Manager tries to add a sign-in to the activity record
- **THEN** it is refused, and the activity record is unchanged

#### Scenario: A look-alike table reaches nothing

- **WHEN** a System Manager creates a table whose name differs from a
  platform record's only in letter case or spacing, of any kind
- **THEN** it is refused, because two tables can never share the same
  storage

#### Scenario: Signing in is still recorded

- **WHEN** the user signs in
- **THEN** the sign-in appears in the activity record, and a System Manager
  can read it there but sees no way to edit or delete it

### Requirement: Exports and prints are recorded

Each time someone exports a table's rows or prints a row, Featherbase SHALL
record who did it, which table and row, and in what format, alongside the
platform's other records. Only someone who can read a table can have an
export of it recorded.

#### Scenario: An export is recorded

- **WHEN** the user exports a list of people as a spreadsheet file
- **THEN** a System Manager can see afterward that this user exported people,
  and in which format

#### Scenario: A print is recorded

- **WHEN** the user prints a row as a PDF
- **THEN** the record names the user, the table, the row and the PDF format

### Requirement: Only a System Manager changes who can do what

The tables that decide access — permissions, roles, role holdings, data
scopes, shares, sign-in methods, identifier systems, installed apps, and the
tables that decide whose sales targets a person sees — and the tables that
make the system act on others' rows (server scripts, workflows, assignment
rules) SHALL refuse every write
from anyone but a System Manager, whatever grants exist on them. Reading them
SHALL stay governed by ordinary grants. A person's roles and whether their
account is enabled SHALL likewise change only for a System Manager, through
every way a row can be saved; values sent back unchanged SHALL NOT block an
ordinary edit. Role rows count as unchanged only when each stored row comes
back once, under its own id, with its own values; their order does not
matter. A save that names the same child row twice SHALL be refused, for
anyone. The check SHALL judge the row as it will be written, after
every save hook and script has run. A workflow or assignment rule SHALL NOT
target an access-control table or a person's roles or enabled flag, neither
when it is saved nor when it acts. Deleting a person, which a delete grant
allows, SHALL drop their roles with them; a person created afresh starts
enabled with no roles.

#### Scenario: A grant on the permission table does not let a user write it

- **WHEN** a user whose role is granted full access to the permission table
  tries to add a permission row
- **THEN** the save is refused

#### Scenario: Editing people does not include their roles

- **WHEN** a user allowed to edit people tries to give someone a role, or to
  disable or enable an account
- **THEN** the save is refused and the person is unchanged

#### Scenario: A save script cannot slip a role in

- **WHEN** a script that runs on every person save adds a role, and a user
  allowed to edit people saves someone's name
- **THEN** the save is refused

#### Scenario: A workflow cannot switch accounts off

- **WHEN** a System Manager saves a workflow whose state is a person's enabled
  flag
- **THEN** the save is refused

#### Scenario: An ordinary edit still saves

- **WHEN** that user edits a person's name and the form sends back the same
  roles and enabled flag
- **THEN** the edit saves

#### Scenario: Reusing a role row's id does not remove a role

- **WHEN** that user saves a person holding two roles and sends both role
  values under one of the two row ids
- **THEN** the save is refused and the person keeps both roles

### Requirement: A release refuses an open access configuration

A release SHALL stop before migrating when any permission row gives every
signed-in user or a guest any access to people or to an access-control table
(wherever the database still keeps that table before migrating),
when any sign-in method creates a new person for anyone it admits outside
development or test, or when
a sign-in method that creates people admits any address or a consumer email
domain.

#### Scenario: Everyone can read people

- **WHEN** a release runs against a database where every signed-in user is
  granted read on people
- **THEN** the release stops, naming that permission row

#### Scenario: Open sign-up in production

- **WHEN** a production release finds password sign-in set to create new people
- **THEN** the release stops and says to set it to refuse

### Requirement: Using an app does not open the administration

An installed app's tables SHALL NOT count towards the administration only when
that app opens at its own root, with pages of its own, whether it is switched on
or off. Reading such an app's tables, or a row of one shared with them, does not
by itself open the administration to a person: they reach those tables through
the app, which keeps working for them as before, and signing in takes them to it.
An app without pages of its own is used through the administration, so its
tables still count, as do grants on the instance's own tables.

#### Scenario: A store manager who only uses Feather Dash

- **WHEN** a store manager whose only grant is to read Feather Dash's own tables
  opens Feather Dash
- **THEN** Feather Dash opens with their figures, and nothing offers them the
  administration
- **AND** if they type an administration address, they are told they have no
  access there

#### Scenario: A manager who also reads an instance table

- **WHEN** the same manager is also given a grant to read one of the instance's
  own tables
- **THEN** they can open the administration, where Feather Dash's tables are
  listed beside that one

#### Scenario: A clerk of an app without pages of its own

- **WHEN** a clerk whose only grant is on the tables of an installed app that
  has no pages of its own signs in
- **THEN** they can open the administration and use that app's tables there,
  as before
