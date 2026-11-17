## ADDED Requirements

### Requirement: An app can ask whether a base Table can be read now
An app SHALL be able to ask whether a declared base Table can be read now, and be told no, without failing its read, for one not listed, deleted, unsupported or missing a declared column.

#### Scenario: A base Table that no longer fits

- **WHEN** an app asks whether a declared Table can be read, and it was deleted or has lost a declared column since
- **THEN** it is told no, and the rest of its read goes on
