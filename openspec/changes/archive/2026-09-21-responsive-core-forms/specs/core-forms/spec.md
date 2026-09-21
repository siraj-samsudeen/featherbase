## REMOVED Requirements
### Requirement: generic_form_layout_baseline
**Reason**: The characterized overflow limitation is replaced by governed responsive behavior.
**Migration**: Generic forms retain their fields and operations but wrap to the available viewport.

## ADDED Requirements
### Requirement: generic_core_form_controls_fit_viewport
Status: governed (#296)

At 375px and desktop widths, generic forms SHALL keep navigation, heading, status, editable fields, Save and attachment upload/download/removal readable and horizontally reachable without page-level clipping. Long identifiers, filenames and error text SHALL not push controls outside the available width. Desktop sections and supplemental panels SHALL retain their wider layout. Keyboard users SHALL be able to focus and operate attachment controls without hover.

#### Scenario: narrow_blank_and_populated_form
- **WHEN** a user opens a blank or populated generic form at 375px
- **THEN** its breadcrumb, title, values and actions fit the available width and remain usable after focusing a field or Save

#### Scenario: narrow_form_errors_remain_visible
- **WHEN** validation fails, a document becomes stale, or save/upload is refused with pending403 or obsolete409
- **THEN** the form retains its unsaved values and readable refusal/error state within the viewport without showing false success or replacing the pinned identity

#### Scenario: narrow_attachment_identity_and_actions
- **WHEN** attachments are empty, uploading, populated with a long filename, or an operation fails
- **THEN** upload, filename/download and removal controls remain reachable, errors remain readable, and removal is visible and operable by keyboard without hover

#### Scenario: desktop_keeps_generic_form_layout
- **WHEN** the same row opens at 1440px
- **THEN** field sections retain multiple columns where applicable and supplemental panels sit beside them with all actions reachable
