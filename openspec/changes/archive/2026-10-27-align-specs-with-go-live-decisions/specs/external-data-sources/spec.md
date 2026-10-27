## REMOVED Requirements

### Requirement: Read and write through a connected table

**Reason**: Its "rows I own" scenario promised the grant is refused when saved; it is accepted and refused when used, and the owner decided on 27-Oct-2026 to keep that (#543). The rest is carried over unchanged below, with "rows I own" as its own requirement.
**Migration**: None; the two requirements below describe what the product does.

## ADDED Requirements

### Requirement: Read and write a connected table at its source

Listing, filtering, sorting and paging a connected table SHALL run against
the data source directly, not a local copy. Where the data source allows
writing, saving and deleting a row SHALL write directly there too, touching
only the columns the table maps — a column the table doesn't map keeps
whatever value it already had. Saving a new row without an id lets the data
source assign one when it can; otherwise the id must be given when the row
is saved.

#### Scenario: Editing leaves the source's own columns alone

- **WHEN** someone edits one mapped field on a connected row that also
  carries a column Featherbase doesn't map
- **THEN** only the mapped field changes at the data source, and the
  unmapped column is untouched

#### Scenario: Counting and filtering happen at the source

- **WHEN** a chart counts a connected table's rows by one of its columns, or a
  list is filtered by a pattern or a list of values
- **THEN** the answer reflects what the data source holds right now, with no
  local copy involved


### Requirement: "Rows I own" is refused on a connected table

A permission limiting a person to the rows they created SHALL save on a connected table, but every read and write through it SHALL be refused, since a connected table can't be limited to the rows a person created. Nothing is shown through such a grant.

#### Scenario: "Rows I own" is refused when it's used

- **WHEN** a builder limits a person's access to a connected table to only the rows they created, and that person opens the table
- **THEN** the permission saved, but the person is refused, and is refused again when they try to change a row
