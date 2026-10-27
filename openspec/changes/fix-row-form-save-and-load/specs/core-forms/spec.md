## ADDED Requirements

### Requirement: A form script's on-load step sees the loaded row

A form script is a small piece of code a developer attaches to a Table to adjust its form. Its on-load step SHALL run once each time a row is opened, after the row has loaded, so it reads the saved values and changes only the fields it sets.

#### Scenario: An on-load step fills in one field

- **WHEN** a form script fills in a note as the form opens, and the user opens a row that already names its store
- **THEN** the note is filled in and the store is still there

#### Scenario: Saving doesn't run it again

- **WHEN** the user saves a row whose on-load step changed a field
- **THEN** the form shows the row as saved, with the value the step set
