# admin-ui-feedback Specification

## Purpose
Describe existing Admin navigation, appearance preferences and import/source feedback before the bounded improvements in issues #67, #96, #97, #109 and #163.

## Requirements

### Requirement: awesomebar_opens_matching_destinations

The awesomebar SHALL offer matching Table lists, new-row actions, commands and record hits.

#### Scenario: record_and_create_destinations
- **WHEN** a user searches a unique record name and then a Table name
- **THEN** the record hit opens its form and the new-row action opens the matched Table's blank form

### Requirement: appearance_preferences_persist_per_user

The Admin SHALL apply a user's theme and palette to the document, persist successful selections on that user, and restore server preferences on a fresh load without inheriting another user's choices.

#### Scenario: theme_and_palette_are_independent
- **WHEN** a user chooses Ivory and dark mode and reloads
- **THEN** both choices remain active and another account retains its own preferences

### Requirement: builder_infers_file_columns

The Table Builder SHALL infer editable columns and preview rows from the first parsed sheet of an accepted file. It SHALL import only those rows when creating the Table.

#### Scenario: csv_preview_matches_import
- **WHEN** a CSV contains text, numeric, date and boolean columns with three unequal rows
- **THEN** the builder previews those rows, proposes their types and creates a Table containing three rows

### Requirement: source_candidates_preserve_fk_metadata

Source introspection SHALL retain driver-provided column types and FK metadata. Reflection SHALL turn FK edges into References when their targets are reflected from the same source with a matching bound primary key.

#### Scenario: fk_target_reflected_after_child
- **WHEN** a child is reflected before its FK target and the target is reflected later
- **THEN** the child's FK becomes a Reference to that target without reflecting the child again
