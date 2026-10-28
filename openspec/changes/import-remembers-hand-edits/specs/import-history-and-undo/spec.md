## ADDED Requirements

### Requirement: Undo closes import conflicts
Undoing an import SHALL close the conflicts that import raised under spreadsheet import's correction-protection rule. It SHALL never restore a field the import kept, because that import did not change it.

#### Scenario: Undo a partially protected import
- **WHEN** an import updated a phone number but kept a corrected city and raised a conflict, and the user undoes it
- **THEN** the phone number returns to its prior value, the corrected city stays, and that import's conflict closes
