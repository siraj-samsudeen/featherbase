## ADDED Requirements

### Requirement: Imports preserve corrections
A Table that keeps change history SHALL preserve a field whose latest change was made by a person when a re-import supplies a different value, and list the conflict with both values, the last editor and time, and the import. Fields last changed by an import SHALL follow the source; this rule applies equally to the import screen and scripted imports.

#### Scenario: Only the corrected field is protected
- **WHEN** the user imports North and a phone number, corrects North to South, then re-imports East and a new phone number
- **THEN** South stays, the phone number updates, and one conflict records South and East with the editor, time and import

#### Scenario: Unchanged source raises nothing
- **WHEN** a corrected field receives its current value or the value the previous import supplied
- **THEN** the correction stays and no new conflict is raised

### Requirement: People resolve import conflicts
The user SHALL be able to keep a correction or take the incoming value, with the decision recorded as their edit. Keeping suppresses the same incoming value on later imports; taking the source lets later imports update that field again.

#### Scenario: Keep a correction
- **WHEN** the user keeps South instead of East and later imports East again
- **THEN** the conflict stays closed
- **AND** importing West raises a new conflict

#### Scenario: Adopt the source
- **WHEN** the user adopts East and a later import supplies West
- **THEN** West updates the field without a conflict

### Requirement: Conflicts respect row and field access
The conflict list SHALL show only rows and fields the user may read. Resolving a conflict SHALL require permission to edit that field of that row.

#### Scenario: Restricted field
- **WHEN** a user cannot read a field that has a conflict
- **THEN** neither its conflict nor its values are shown to that user

### Requirement: Preview explains protected fields
The import check SHALL count fields it will update and fields it will keep and flag, per Table. When a Table keeps no change history, the check SHALL explain that imports overwrite existing values.

#### Scenario: Check a correction
- **WHEN** a re-import would update one untouched field and conflict with one correction
- **THEN** the check reports one updated field and one kept field before anything commits
