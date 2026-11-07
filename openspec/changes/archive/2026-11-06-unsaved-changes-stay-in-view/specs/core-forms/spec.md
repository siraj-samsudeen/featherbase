## ADDED Requirements

### Requirement: Unsaved changes stay in view, and leaving asks first

While an editable form has unsaved changes, a bar SHALL stay in view at the foot of the page, saying "Unsaved changes" with a Save button that does what the form's own Save does. Leaving for another page SHALL ask first, and reloading or closing the tab SHALL bring up the browser's warning.

#### Scenario: A change high on a long form

- **WHEN** a person changes a field and scrolls down the form
- **THEN** the bar and its Save stay on screen

#### Scenario: Staying

- **WHEN** a person with unsaved changes follows a link and chooses Stay
- **THEN** they remain on the form with their changes

#### Scenario: Leaving

- **WHEN** a person with unsaved changes follows a link and chooses Leave without saving
- **THEN** they go to the link and the changes are dropped

#### Scenario: A new row saved

- **WHEN** a person saves a new row
- **THEN** the form goes to the new row without asking

#### Scenario: Nothing to save

- **WHEN** a form has no unsaved changes, or the person can only read the row
- **THEN** no bar shows and leaving asks nothing

#### Scenario: No warning for what loses nothing

- **WHEN** the person switches tabs on the same row, or leaves a new row holding only prefilled values nobody changed
- **THEN** nothing asks
