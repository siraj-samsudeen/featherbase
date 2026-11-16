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

```gherkin
Given a table "Memos" with no permissions configured for it at all
And the user is a System Manager
When the user opens "Memos"
Then the user can read its rows
And the user can create a row
And the user can edit a row
And the user can delete a row
```

### Requirement: A role's grant on a table

For each table, a role SHALL be granted its own combination of reading,
creating, editing and deleting rows, and — for rows that go through a formal
submit step — submitting, cancelling and amending them. A person without a
grant for an action on a table SHALL be refused that action there.

#### Scenario: No delete grant

```gherkin
Given a table "Memos" with a row "M-1"
And the user's roles are granted read and write on "Memos", but not delete
When the user tries to delete "M-1"
Then the deletion is refused
```

### Requirement: Set a table's grants in one place

A System Manager SHALL be able to see every role against a table's actions in
one place and change any role's grants there. A change SHALL apply to
everyone holding that role on their very next request, without them signing
in again.

#### Scenario: Granting read takes effect at once

```gherkin
Given a role with no read access to a table "Memos"
And the user holds that role and is signed in
When a System Manager gives the role read access to "Memos"
Then the user's next attempt to open the list of "Memos" succeeds
When a System Manager takes that read access away
Then the user's next attempt to open the list of "Memos" is refused
```

### Requirement: A grant can be limited to rows someone created

A role's grant on a table SHALL optionally apply only to the rows the
person themselves created, rather than every row. This holds wherever rows
are listed, searched, opened or counted.

#### Scenario: Limited to your own rows

```gherkin
Given a table "Notes" with a row "N-1" created by someone else
And the user may read every row of "Notes"
And the user holds a write grant on "Notes" limited to rows they created
When the user opens "N-1" and tries to edit it
Then the edit is refused
```

### Requirement: Access can be narrowed to specific rows

Beyond what a role grants, a person's access SHALL be narrowable to a chosen
set of rows, or to rows that reference a chosen set of rows in another table.
This narrowing SHALL hold wherever rows are listed, searched, opened or
counted, and SHALL NOT apply to a System Manager.

#### Scenario: Narrowed to one region's rows

```gherkin
Given customers "Asha" in the north and "Bram" in the south
And orders "O-1" for Asha and "O-2" for Bram
And the user's access to Customers is narrowed to the customers in the north
When the user opens the full customer list
Then the user sees only Asha
And the list of orders hides "O-2"
```

#### Scenario: A row that names no customer stays visible

```gherkin
Given the user's access to Customers is narrowed to the customers in the north
And an order "O-1" for a customer in the north, an order "O-2" for one in the south, and an order "O-3" that names no customer
When the user opens the list of orders
Then the user sees "O-1" and "O-3"
And the user does not see "O-2"
```

### Requirement: A single row can be shared beyond its role grants

A System Manager SHALL be able to share a specific row with a chosen person,
giving them reading or editing, even if their roles alone wouldn't grant that
on the table it belongs to.

#### Scenario: Shared with someone outside the role grant

```gherkin
Given a table "Memos" with rows "M-1" and "M-2"
And the user has no write grant on "Memos"
When a System Manager shares "M-1" with the user for editing
Then the user can edit "M-1"
And the user cannot edit "M-2"
```

### Requirement: A column can be marked sensitive

A column SHALL be markable so that only roles with the deeper access it
requires can see, search or change it. Wherever rows are listed, searched,
opened, printed or returned after a save, that column is omitted for
everyone else, and a change to it from them is refused, with nothing in that
change saved. A sensitive column in a row's line items is treated the same
way: it shows to someone whose access to the row, or to the line items
themselves, reaches it.

#### Scenario: A sensitive column is hidden

```gherkin
Given an employee row "Alice" whose salary is a sensitive column
And the user does not have the deeper access the salary requires
When the user opens "Alice"
Then the salary is absent from what the user sees, not shown blank or masked
```

#### Scenario: A sensitive column in the line items

```gherkin
Given a quote "Q-1" with a line "Bolt" whose unit cost is 4200, a sensitive column
And the user does not have the deeper access the unit cost requires
When the user opens "Q-1", renames the line to "Bolt M8" and saves
Then no line shows the unit cost in the form
And no line shows the unit cost in the saved reply
And no line shows the unit cost in print
And the stored unit cost is still 4200
```

### Requirement: Stored passwords and secrets never leave the server

A stored password, secret key or token fingerprint SHALL never be shown,
searched, sorted or changed through any list, form or connected data source,
for anyone, a System Manager included. Asking for one is refused, and a write
naming one is dropped rather than saved.

#### Scenario: A System Manager opens a person

```gherkin
Given a person "Asha" who has a password
And the user is a System Manager
When the user opens "Asha" and lists people
Then no password appears
And asking the list for the password is refused
```

#### Scenario: A connected table with a password column

```gherkin
Given another database with a table "tenant" that has a "password" column
And the user is a System Manager
When the user connects "tenant"
Then the "password" column is left out of the connected table
And asking for the "password" column is refused
```

### Requirement: A refusal explains itself

When a table, a row, or an action on it is refused, Featherbase SHALL show
why in place of the list or form, rather than showing nothing or an empty
list.

#### Scenario: Refused list

```gherkin
Given a table "Back Office"
And the user's roles grant no read on "Back Office"
When the user opens the list of "Back Office"
Then the user sees a message that they can't read it
And the user does not see an empty list
```

### Requirement: The screen shows only what a person can use

After signing in, a person SHALL see only the tools they can use, decided by
the server from their current roles and grants.

#### Normative details for the whole requirement

Someone whose only access is
the Sales Target report SHALL get a bare screen — the report, their name,
their own sign-in methods and sign-out — with no administration menu, and
without the page asking for anything they would be refused. Someone with no
role of use at all SHALL get a plain page saying they have no access yet and
that an admin has been told, with sign-out; until they are given a role they
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

```gherkin
Given the user holds only the Sales Target Viewer role
When the user opens an administration address
Then the user is taken to the Sales Target report
And no administration menu appears
And no administration request is made
```

#### Scenario: A person with no access is told so

```gherkin
Given the user holds no role of use
When the user signs in
Then the user sees that they have no access yet
And the user sees that an admin has been told
And the user sees a way to sign out
```

#### Scenario: A management address typed by someone else

```gherkin
Given the user is not a System Manager
When the user types the address for importing data
Then the user lands on the administration home
```

### Requirement: The platform's own records cannot be forged or erased

Records the platform keeps about what happened, such as who signed in, what
changed and which jobs ran, SHALL be written only by the platform itself. No
one, a System Manager, the Administrator or an access token included, SHALL
be able to add, change or remove them, by hand, by import or by changing
their columns. Anyone allowed to read them still can.

#### Scenario: An administrator tries to add a sign-in

```gherkin
Given the user is a System Manager
When the user tries to add a sign-in to the activity record
Then it is refused
And the activity record is unchanged
```

#### Scenario: A look-alike table reaches nothing

```gherkin
Given the user is a System Manager
When the user creates a table named "ACTIVITY  LOG"
Then it is refused, because two tables can never share the same storage
```

#### Scenario: Signing in is still recorded

```gherkin
Given the user is a System Manager
When the user signs in
Then the sign-in appears in the activity record
And the user can read it there
And the user sees no way to edit or delete it
```

### Requirement: Exports and prints are recorded

Each time someone exports a table's rows or prints a row, Featherbase SHALL
record who did it, which table and row, and in what format, alongside the
platform's other records. Only someone who can read a table can have an
export of it recorded.

#### Scenario: An export is recorded

```gherkin
Given the user can read people
When the user exports a list of people as a spreadsheet file
Then a System Manager can see afterward that the user exported people
And in which format
```

#### Scenario: A print is recorded

```gherkin
Given the user can read the row "P-1" of a table "Print Doc"
When the user prints "P-1" as a PDF
Then the record names the user, the table "Print Doc", the row "P-1" and the PDF format
```

### Requirement: Only a System Manager changes who can do what

The tables that decide access — permissions, roles, role holdings, data
scopes, shares, sign-in methods, identifier systems, installed apps, and the
tables that decide whose sales targets a person sees — and the tables that
make the system act on others' rows (server scripts, workflows, assignment
rules) SHALL refuse every write
from anyone but a System Manager, whatever grants exist on them.

#### Normative details for the whole requirement

Reading them
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

```gherkin
Given the user's role is granted full access to the permission table
When the user tries to add a permission row
Then the save is refused
```

#### Scenario: Editing people does not include their roles

```gherkin
Given the user may edit people but is not a System Manager
And a person "Asha" holds no roles
When the user tries to give "Asha" a role
Then the save is refused
And "Asha" is unchanged
```

#### Scenario: A save script cannot slip a role in

```gherkin
Given the user may edit people but is not a System Manager
And a script that runs on every person save adds a role
When the user saves the name of a person "Asha"
Then the save is refused
```

#### Scenario: A workflow cannot switch accounts off

```gherkin
Given the user is a System Manager
When the user saves a workflow whose state is a person's enabled flag
Then the save is refused
```

#### Scenario: An ordinary edit still saves

```gherkin
Given the user may edit people but is not a System Manager
When the user changes the name of a person "Asha" and the form sends back the same roles and enabled flag
Then the edit saves
```

#### Scenario: Reusing a role row's id does not remove a role

```gherkin
Given the user may edit people but is not a System Manager
And a person "Asha" holds two roles
When the user saves "Asha" with both role values under one of the two row ids
Then the save is refused
And "Asha" keeps both roles
```

### Requirement: A release refuses an open access configuration

A release SHALL stop before migrating when any permission row gives every
signed-in user or a guest any access to people or to an access-control table
(wherever the database still keeps that table before migrating),
when any sign-in method creates a new person for anyone it admits outside
development or test, or when
a sign-in method that creates people admits any address or a consumer email
domain.

#### Scenario: Everyone can read people

```gherkin
Given every signed-in user is granted read on people
When a release runs against that database
Then the release stops, naming that permission row
```

#### Scenario: Open sign-up in production

```gherkin
Given password sign-in is set to create new people
When a production release runs
Then the release stops and says to set it to refuse
```

### Requirement: Using an app does not open the administration

An installed app's tables SHALL NOT count towards the administration only when
that app opens at its own root, with pages of its own, whether it is switched on
or off.

#### Normative details for the whole requirement

Reading such an app's tables, or a row of one shared with them, does not
by itself open the administration to a person: they reach those tables through
the app, which keeps working for them as before, and signing in takes them to it.
An app without pages of its own is used through the administration, so its
tables still count, as do grants on the instance's own tables.

#### Scenario: A store manager who only uses Dash

```gherkin
Given a store manager whose only grant is to read Dash's own tables
When the user opens Dash
Then Dash opens
And nothing offers the user the administration
When the user types an administration address
Then the user is sent to Dash
```

#### Scenario: A manager who also reads an instance table

```gherkin
Given a store manager whose only grant is to read Dash's own tables
And the user is also given a grant to read one of the instance's own tables
When the user opens the administration
Then it opens
And Dash's tables are listed beside that one
```

#### Scenario: A clerk of an app without pages of its own

```gherkin
Given an installed app that has no pages of its own
And a clerk whose only grant is on that app's tables
When the user signs in
Then the user can open the administration
And the user can use that app's tables there
```

### Requirement: A role that may only create rows keeps what it typed

A new row SHALL keep every column its creator filled in that their role's
create or edit access reaches. A role allowed to create rows but not to
edit them SHALL therefore save a new row with what was typed, and cannot
change it afterwards.

#### Scenario: Create without edit

```gherkin
Given the user's role may create orders but not edit them
When the user saves a new order titled "Planner order"
Then the order is saved with that title
And a later change to it is refused
```

### Requirement: Roles given at creation are in a person's history

Creating a person with roles SHALL record one history entry naming who created them and the roles they were given. That entry alone SHALL NOT keep the person from being deleted, and SHALL go with them. A later change to the person SHALL still keep them from being deleted.

#### Scenario: A person created with a role shows it in Activity

```gherkin
Given the user is an administrator
When the user creates a person with the role "Rh Clerk"
Then the person's Activity shows the user created them
And it shows "Roles: ∅ → Rh Clerk"
```

#### Scenario: A person with only their creation entry can still be deleted

```gherkin
Given a person created with the role "Rh Clerk", and not changed since
When the person is deleted
Then the person and their roles are removed
And no history is left behind
```

### Requirement: A grant can reach only some columns

A role's grant to read, create or change a table's rows SHALL say which columns it
reaches: every ordinary column, every column including sensitive ones, or only the
columns it lists. The first two keep reaching columns the table gains later; a list
reaches only what it names.

#### Scenario: A detail that may be read but not changed

```gherkin
Given a role may read a quote's title and unit cost but may change only its title
And the user holds that role
When the user changes the title and the unit cost of the quote "Q-1" and saves
Then the save is refused
And the quote "Q-1" keeps its old title and unit cost
```

### Requirement: Roles given to everyone who signs in

A System Manager SHALL be able to name, in System Settings, roles that every person holds without adding them to each Person. Only a System Manager SHALL change them, each SHALL be an existing role other than a platform role, and an instance settings file SHALL NOT carry them.

#### Scenario: A newcomer holds the role everyone holds

```gherkin
Given System Settings gives "Tasker Member" to everyone who signs in
When a person with no roles of their own signs in
Then they can do what Tasker Member may do
```

#### Scenario: Someone who signs in later holds it too, and a service account does not

```gherkin
Given System Settings names "Tasker Member" for everyone who signs in
When a person signs in for the first time
Then they hold Tasker Member
And a service account still doesn't
```

#### Scenario: Removing the role takes it only from those who held it that way

```gherkin
Given System Settings gives "Tasker Member" to everyone who signs in
And one person holds it only through the setting, and another was given it directly
When "Tasker Member" is removed from the setting
Then the first no longer holds it
And the second still does
```

#### Scenario: A platform role cannot be given to everyone

```gherkin
Given the user is a System Manager
When the user names System Manager in the setting
Then the save is refused with "System Manager cannot be given to everyone"
```

#### Scenario: A person's pages say where the role comes from

```gherkin
Given System Settings gives "Tasker Member" to everyone who signs in
And a person holds Tasker Member only through the setting
When a System Manager opens the person's access page
Then it says "everyone who signs in holds it (System Settings)"
When a System Manager opens the person's Person form
Then it says "Everyone who signs in also holds Tasker Member, set in System Settings."
```

### Requirement: A table names what narrows it

A table SHALL be able to name which of its references narrow its rows. Once it does, only those references narrow it. A table that names none is narrowed by every reference, as before.

#### Scenario: A supplier store does not hide a row

```gherkin
Given a sections table narrowed by its store alone
And the user is narrowed to the North store
When the user opens the sections table
Then the user sees North's sections, including one whose supplier store is South
```

### Requirement: A table can stay closed without narrowing

A table SHALL be able to require narrowing. Someone who has none on the references it names then sees none of its rows and can neither open, add, change nor delete any, and a row that names nothing on those references is closed to them too. This SHALL NOT apply to a System Manager.

#### Scenario: A store manager whose scope never arrived

```gherkin
Given a sections table that requires narrowing
And a store manager with no narrowing at all
When the user opens the sections table
Then the list is empty
And opening, adding or changing a section is refused
```

#### Scenario: A section that names no store

```gherkin
Given a sections table that requires narrowing
And a store manager narrowed to the North store
When the user opens the sections table
Then the user sees North's sections
And not one that names no store
```

### Requirement: Taking a grant away keeps its history

Unticking a grant where a table's grants are set SHALL end the access on the next request, even when the grant has history, comments, attachments or shares. What the grant holds SHALL stay, with one more history entry naming who ended it and what it was. This SHALL hold only there: any other delete of a grant keeps the rule that a row with history cannot be deleted.

#### Scenario: A grant that was edited

```gherkin
Given a role's read grant on a table, edited before
And a person holding that role
When a System Manager unticks read for the role
Then the person is refused the table on their next request
And the grant's history can still be read, ending with who took it away and what it was
```

#### Scenario: Deleting the same grant any other way

```gherkin
Given a role's read grant on a table, edited before
When a System Manager deletes that grant from its own row instead
Then the delete is refused and the grant stays
```

