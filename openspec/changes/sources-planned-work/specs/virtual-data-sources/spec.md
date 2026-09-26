## ADDED Requirements

### Requirement: A table backed by code instead of a database

An app SHALL be able to back a Featherbase table with its own code instead of
a database connection, so it can read and write something else entirely — a
web API, a queue, a file another program maintains. The table SHALL still
appear, and be used, like any other Featherbase table: browsing, filtering,
opening a row, saving and deleting all work, but every one of them is
answered by the app's own code rather than by Featherbase's storage.

#### Scenario: Listing rows from a web API

- **WHEN** someone opens a table backed by an app's own code that fetches
  from a web service
- **THEN** the rows shown come from that service, fetched at the moment the
  list is opened

### Requirement: Missing pieces are caught when the table is set up, not on first use

An app that backs a table this way SHALL supply everything Featherbase needs
to read, write and delete through it. If anything is missing, Featherbase
SHALL refuse to bring the table online at all and say what's missing, rather
than letting it fail the first time someone tries to use it.

#### Scenario: An incomplete backing

- **WHEN** an app backs a table with code that can read and save rows but not
  delete them
- **THEN** the table fails to come online, saying that deleting isn't
  supported

### Requirement: Honest about what this kind of table can't do

A table backed this way SHALL NOT offer a repeating-rows column, since
nothing keeps those saved. It SHALL be left out of the checks that would
normally stop a row from being deleted while something else still links to
it, and the table's own screen SHALL say so.

#### Scenario: Adding a repeating-rows column is refused

- **WHEN** someone tries to add a repeating-rows column to a table backed by
  an app's own code
- **THEN** it's refused, saying repeating rows aren't supported on this kind
  of table
