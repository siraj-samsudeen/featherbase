## MODIFIED Requirements

### Requirement: Archive a table without deleting it

A System Manager SHALL be able to archive a custom table or an installed app's table, with an optional note of what replaced it, and to
un-archive it. While archived, its rows and history SHALL stay readable to whoever could read them, and adding,
changing, retiring, reactivating, deleting, permanently deleting, importing or merging its rows SHALL be refused for everyone, administrators included. Platform
tables, settings, sub-tables, an app's entry table and tables that decide access SHALL NOT be archived, except that an
installed app's table that decides access MAY be archived while it holds no rows. Archiving an app's table SHALL leave
the app's reads and people's scope as they were, and SHALL last through a redeploy and an app upgrade.

#### Scenario: Archive a replaced table

- **WHEN** a System Manager archives Operating Site, noting "Replaced by Site Master"
- **THEN** its rows still open for everyone who could read them

#### Scenario: No edits to an archived table

- **WHEN** anyone, an administrator included, tries to add, change, retire, reactivate, delete, permanently delete or import a row of an archived table
- **THEN** the change is refused, saying the table is archived

#### Scenario: Un-archive

- **WHEN** a System Manager un-archives the table
- **THEN** its rows can be changed again

#### Scenario: Delete it later

- **WHEN** a System Manager deletes an archived table
- **THEN** it is deleted as any custom table is

#### Scenario: Only a custom table

- **WHEN** someone tries to archive a platform table, a settings table, a sub-table, an app's entry table or a
  table that decides who can see what, or
  someone who is not a System Manager tries to archive any table
- **THEN** it is refused

#### Scenario: An app's unused table

- **WHEN** a System Manager archives Store floor, a table the Dash app installed and does not use yet
- **THEN** it is archived, Dash's own reads of it still work, and a Dash action that writes to it is refused, saying the table is archived

#### Scenario: An app's table that decides access

- **WHEN** a System Manager archives an app's table that decides who can see what
- **THEN** it is archived if it holds no rows, people's scope stays the same, and no rows can be added until it is un-archived
- **AND** it is refused if it holds rows

#### Scenario: Archived through an upgrade

- **WHEN** an app is redeployed or upgraded while one of its tables is archived, even by a version that renames that table or changes its columns
- **THEN** the upgrade succeeds and the table is still archived, with its note
