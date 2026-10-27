# Permissions and Roles Delta

## MODIFIED Requirements

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

### Requirement: A column can be marked sensitive

A column SHALL be markable so that only roles with the deeper access it
requires can see, search or change it. Wherever rows are listed, searched or
opened, that column is omitted for everyone else, and a write to it from them
is silently dropped rather than saved.

#### Scenario: A sensitive column is hidden

- **WHEN** a user without the deeper access opens a row that has a sensitive
  column
- **THEN** the column is absent from what they see, not shown blank or
  masked
