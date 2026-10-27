## ADDED Requirements

### Requirement: The new-row form asks for a typed-in name

When a Table's rows are named by whoever creates them, the form for a new row SHALL ask for that name, and leaving it blank SHALL call out the name rather than only refusing the save.

#### Scenario: Add a row from the form

- **WHEN** the user opens a new row of a Table whose rows they name, types "shelf-a1" as its name and saves
- **THEN** the row is saved under the name "shelf-a1" and opens

#### Scenario: Forget the name

- **WHEN** the user fills in a new row of that Table but leaves its name blank and saves
- **THEN** nothing is saved, the name is called out as required, and what they typed stays on screen
