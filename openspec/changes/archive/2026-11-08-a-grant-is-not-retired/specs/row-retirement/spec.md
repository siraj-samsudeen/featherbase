## MODIFIED Requirements

### Requirement: Every Table that stores its own rows can retire them the same way

Retiring SHALL work the same way on every Table that stores its own rows, with no setup by the
Table's designer. Lines inside another row, Settings tables and Tables read from an outside
database SHALL NOT offer it. Nor SHALL the Permission table: a grant ends by unticking it in the
permission matrix, and retiring one is refused, saying so.

#### Scenario: A new table can retire at once

- **WHEN** a builder creates a table of plants and adds "Sample plant"
- **THEN** "Sample plant" can be retired without any change to the table

#### Scenario: A grant is not retired

- **WHEN** a System Manager tries to retire a role's read grant on plants
- **THEN** it is refused, saying to untick it in the permission matrix
- **AND** a person holding that role can still read plants
