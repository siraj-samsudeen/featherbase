## RENAMED Requirements

- FROM: `### Requirement: An upgrade only adds, and needs turning on afterward`
- TO: `### Requirement: An upgrade keeps what it does not remove, and needs turning on afterward`

## MODIFIED Requirements

### Requirement: An upgrade keeps what it does not remove, and needs turning on afterward

Upgrading an app SHALL keep every existing row and its id exactly as it was,
except what the new version explicitly declares it removes. Once an upgrade is
applied, the app SHALL be unavailable to everyone — not still running on its
previous version — until the admin explicitly activates the new one.

#### Scenario: Existing rows survive, extra fields start empty

- **WHEN** Tasker is upgraded to a version that adds an optional project
  description
- **THEN** every existing project keeps its data
- **AND** the new description starts empty until someone fills it in

#### Scenario: Turning it on is a separate, explicit step

- **WHEN** an admin applies a reviewed upgrade
- **THEN** the app is unavailable to everyone until the admin separately
  activates the new version

## ADDED Requirements

### Requirement: An upgrade can reshape the app's own tables

A new version of an app SHALL be able to add and remove its tables, add a
column of any kind, change a column's label, choices, default, whether it is
required, unique or hidden, rename a column or a table, and remove a column.
A rename SHALL keep the rows, their history, the links to them and who may see
them. An upgrade SHALL change only the app's own tables, never Featherbase's
or the instance's.

#### Scenario: A renamed table keeps its rows and history

- **WHEN** an app's new version renames its Note table to Memo, and two notes
  with a comment on one of them exist
- **THEN** after the upgrade both rows are in Memo
- **AND** the comment still belongs to its row

#### Scenario: A table that decides people's scope stays guarded

- **WHEN** an app renames a table whose rows decide which places people cover
- **THEN** the renamed table still decides scope
- **AND** only a System Manager can still change its rows

### Requirement: A change of kind keeps every value

An upgrade SHALL change a column's kind only where every stored value carries
over, such as whole numbers to decimals or a date to a date and time. Any other
change of kind SHALL be refused: the app adds a new column, copies the data and
then removes the old one.

#### Scenario: Whole numbers become decimals

- **WHEN** an upgrade changes a quantity column from whole numbers to decimals
- **THEN** every quantity keeps its value

#### Scenario: A change that would lose values is refused

- **WHEN** a new version changes a number column into a date column
- **THEN** that version is refused before anything runs

### Requirement: Removing data is declared and counted first

A step that removes data — a table, a column, or values outside a column's new
choices — SHALL be declared as removing data in the app's version; an
undeclared one SHALL be refused. Before it runs, the upgrade's preview, the
release check and a rehearsal on a copy of the instance SHALL each say how many
rows or values that instance would lose, without ever showing the values.

#### Scenario: The preview counts what will go

- **WHEN** an admin previews an upgrade that removes a legacy code column held
  by two items, and a table of two notes
- **THEN** the preview says the upgrade removes 2 values and 2 rows
- **AND** nothing is removed until the admin applies it

#### Scenario: An undeclared narrowing is refused

- **WHEN** an upgrade narrows a column's choices while a row still uses a
  choice it drops, and the step is not declared as removing data
- **THEN** the preview refuses the upgrade and says how many values it would
  clear

### Requirement: Installing fresh and upgrading give the same tables

Installing a version of an app directly and upgrading to it from an earlier
version, one version at a time, SHALL give exactly the same tables, columns,
rules and access.

#### Scenario: Two routes, one result

- **WHEN** one instance installs version 0.3.0 of an app and another installs
  0.1.0 and upgrades to 0.2.0 and then 0.3.0
- **THEN** both have the same tables, columns, rules and access

### Requirement: A new table arrives with the access its version declares

A table an upgrade adds SHALL arrive with exactly the access its new version
declares for it, listed in the preview. Access to the tables the app already
had SHALL never widen through an upgrade.

#### Scenario: A new supplier table is readable by the clerks

- **WHEN** an upgrade adds a Supplier table that its version lets clerks read
- **THEN** the preview lists that access
- **AND** after the upgrade clerks can read suppliers
