## ADDED Requirements

### Requirement: Archive a table without deleting it

A System Manager SHALL be able to archive a custom table, with an optional note of what replaced it, and to
un-archive it. While archived, its rows and history SHALL stay readable to whoever could read them, and adding,
changing, deleting, importing or merging its rows SHALL be refused for everyone, administrators included. Platform
tables, settings, sub-tables, an installed app's tables and tables that decide access SHALL NOT be archived.

#### Scenario: Archive a replaced table

- **WHEN** a System Manager archives Operating Site, noting "Replaced by Site Master"
- **THEN** its rows still open for everyone who could read them

#### Scenario: No edits to an archived table

- **WHEN** anyone, an administrator included, tries to add, change, delete or import a row of an archived table
- **THEN** the change is refused, saying the table is archived

#### Scenario: Un-archive

- **WHEN** a System Manager un-archives the table
- **THEN** its rows can be changed again

#### Scenario: Delete it later

- **WHEN** a System Manager deletes an archived table
- **THEN** it is deleted as any custom table is

#### Scenario: Only a custom table

- **WHEN** someone tries to archive a platform table, a settings table, a sub-table, an installed app's table or a
  table that decides who can see what, or
  someone who is not a System Manager tries to archive any table
- **THEN** it is refused

### Requirement: An archived table is out of everyday use

An archived table SHALL be left out of the module menus, the command bar and the table pickers, and SHALL be listed
under "Archived" on All tables. Its list and its rows SHALL say it is archived, by whom, when, and what replaced it.

#### Scenario: Out of the menus

- **WHEN** a table is archived
- **THEN** it no longer shows in its module's menu, the command bar or a table picker, and All tables lists it under
  "Archived"

#### Scenario: The banner says why

- **WHEN** someone opens the list or a row of Operating Site, archived by Siraj today and noted "Replaced by Site Master"
- **THEN** a banner says it is archived, by Siraj, today, and "Replaced by Site Master"

#### Scenario: Back in the menus

- **WHEN** a System Manager un-archives it
- **THEN** it is back in its module's menu
