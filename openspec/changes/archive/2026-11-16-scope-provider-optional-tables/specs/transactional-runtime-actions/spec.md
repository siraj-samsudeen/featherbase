## ADDED Requirements

### Requirement: A scope provider can ask whether a Table can be read now
A scope provider SHALL be able to ask whether one of its Tables can be read now. It SHALL be told no, without
failing the person's scope, for a Table it did not declare, one the instance does not have, or one it may not read.
A Table it is told no about SHALL contribute nothing to the scope; reading it anyway SHALL still refuse the scope.

#### Scenario: A Table not installed yet contributes nothing

- **WHEN** a scope provider asks about a declared Table the instance does not have
- **THEN** it is told no, and the person's scope is what its other Tables give, never more

#### Scenario: Reading a Table that is not available still refuses

- **WHEN** a scope provider reads a Table it was told is not available
- **THEN** the person gets no scope, as for any failed read
