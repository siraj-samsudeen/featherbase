## ADDED Requirements

### Requirement: generated_controls_have_accessible_names

Generated form controls SHALL be programmatically associated with their visible labels using stable IDs unique to the mounted form. Required markers SHALL not replace the field name. Sub-table cell controls SHALL have distinct stable IDs and accessible names including their grid, column and row position. Labels SHALL remain associated after editing, adding, removing or reordering rows. Reference and attachment fields SHALL associate labels with an actual control rather than a wrapper.

#### Scenario: generated_field_labels_resolve
- **WHEN** a form renders text, required text, checkbox, Choice, Reference and attachment fields
- **THEN** each control is addressable by its field label and IDs remain unchanged after an edit

#### Scenario: repeated_child_columns_are_distinct
- **WHEN** two rows share the same child-column names and a second grid uses the same child schema
- **THEN** every cell is uniquely addressable by grid, column and row and names remain correct after removing or reordering a row

#### Scenario: attachment_actions_are_keyboard_accessible
- **WHEN** a form renders two Attach fields and one Attach Image field
- **THEN** each visible attachment action has an accessible name identifying its action and field, and keyboard activation opens that field's file chooser

#### Scenario: child_identity_survives_movement
- **WHEN** persisted or unsaved child rows are edited, reordered or adjacent rows are removed
- **THEN** each surviving mounted control retains its DOM node and ID, its accessible name reflects its current position, and repeated grids never share control IDs
