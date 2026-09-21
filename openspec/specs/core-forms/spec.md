# core-forms Specification

## Purpose
Describes the generic metadata-driven row editor and its attachment operations, independently of any runtime application.

## Requirements

### Requirement: generic_row_editor_preserves_field_contract
Status: characterized (#296)

The generic editor SHALL render metadata-defined fields, mark edited values unsaved, persist valid edits on Save, and keep invalid edits visible with field errors. Existing rows SHALL expose linked attachments with upload, download and removal operations.

#### Scenario: generic_fields_save_or_show_errors
- **WHEN** an editor changes a populated field and saves
- **THEN** valid values persist and show Saved, while invalid values remain unsaved with an error beside the field

#### Scenario: generic_attachment_lifecycle
- **WHEN** an editor uploads two attachments and removes one
- **THEN** both are initially listed and downloadable, and removal deletes only the selected attachment and its storage object

### Requirement: generic_form_layout_baseline
Status: characterized (#296)

The editor SHALL place its breadcrumb above a heading/status and action row. Field sections SHALL use one column below the medium breakpoint and two above; the supplemental panels SHALL stack below fields until the large breakpoint. This baseline does not guarantee horizontal containment: the unwrapped action row can overflow narrow screens, and attachment removal is visually exposed on hover only.

#### Scenario: narrow_layout_stacks_panels_but_actions_can_overflow
- **WHEN** an existing row is opened at 375px with the standard actions
- **THEN** supplemental panels stack below fields but the action row may exceed the available width
