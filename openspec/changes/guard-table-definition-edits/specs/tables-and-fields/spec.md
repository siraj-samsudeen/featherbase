## ADDED Requirements

### Requirement: Existing duplicates explain why uniqueness cannot be enabled

When a builder asks for unique values and existing rows repeat a value, the change SHALL be refused with the repeated value and affected column named. The Table and its rows SHALL remain unchanged.

#### Scenario: Two rows have the same code

- **WHEN** the user makes a code unique while two rows have code A
- **THEN** the change is refused, naming the code and A, and both rows remain unchanged

### Requirement: Links target a Table that exists

When a builder saves a Table definition, each link SHALL target an existing Table or the Table being defined. A missing target SHALL be named and the definition left unchanged.

#### Scenario: A link target is missing

- **WHEN** the user adds a customer link targeting a Table that does not exist
- **THEN** the change is refused and names that missing Table

#### Scenario: A hierarchy links to itself

- **WHEN** the user creates a category Table whose parent links to the same Table
- **THEN** the definition is accepted
