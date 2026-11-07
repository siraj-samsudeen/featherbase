## ADDED Requirements

### Requirement: A rename moves the column a row is named after

Renaming a row named after one of its own columns SHALL change that column too, in the same save, and the column's rules SHALL judge the new value. A read-only column SHALL NOT be moved by a rename, so the rename is refused.

#### Scenario: Rename a cluster named by its code

- **WHEN** the row VLM, named after its code column, is renamed to TVM
- **THEN** its ID and its code both read TVM, and links to it follow

#### Scenario: A new ID the column refuses

- **WHEN** a row is renamed to a value its column can't hold, such as text in a number column or a value another row holds in a unique column
- **THEN** the rename is refused and the row is unchanged

#### Scenario: A prefixed ID

- **WHEN** a Table's IDs are "CL-" followed by a column, and a row is renamed to an ID without "CL-"
- **THEN** the rename is refused, saying what an ID looks like
