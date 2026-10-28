## ADDED Requirements

### Requirement: A file on a row follows the row's access

A file attached to a row SHALL be listed, opened and removed only by someone
who can open that row, or with whom the row is shared, whatever their access
to files in general. A file attached to a whole table, or to nothing, SHALL
follow the access to files.

#### Scenario: Files on someone else's row

- **WHEN** a user who may read every file but only their own orders looks
  through the list of files
- **THEN** they see the files on their own orders and none on anyone else's

#### Scenario: Removing a file on a row the user cannot open

- **WHEN** a user who may remove files names a file attached to a row they
  cannot open
- **THEN** it is refused and the file is kept
