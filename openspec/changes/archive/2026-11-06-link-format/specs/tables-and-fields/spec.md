## ADDED Requirements

### Requirement: A Table chooses how links to it read

A Table SHALL choose how links to its rows read: Name (code), the default; Code (name); Name only; or Code only. The choice SHALL apply wherever a link to that Table shows. The code is the row's ID, when its IDs are codes people use.

#### Scenario: Each format

- **WHEN** a Cluster row has the code VLM and the name Vellayambalam
- **THEN** a link reads "Vellayambalam (VLM)" in Name (code), "VLM (Vellayambalam)" in Code (name), "Vellayambalam" in Name only, and "VLM" in Code only

#### Scenario: No separate code

- **WHEN** a Table's rows are numbered by a series, or their ID already is their name
- **THEN** a link reads just the name, in every format

#### Scenario: Changing it leaves the columns alone

- **WHEN** a System Manager changes a Table's format
- **THEN** every link to it reads the new way, and its columns are unchanged
- **AND** an update to the Table's definition that leaves the format out keeps it

#### Scenario: A row the viewer can't read

- **WHEN** a link points at a row the viewer can't read
- **THEN** it reads as neutral words in every format

#### Scenario: A Table with no name column

- **WHEN** a Table has no name column, and its stand-in title holds a name and a code
- **THEN** a link follows the format, with no dot left over
