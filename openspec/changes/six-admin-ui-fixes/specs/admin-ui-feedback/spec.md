## ADDED Requirements

### Requirement: awesomebar_results_disambiguate_destinations

Awesomebar results SHALL distinguish commands, Table lists, row creation and records with visible category headings or self-describing text. Table subtitles SHALL identify their module and list destination; record subtitles SHALL identify their containing Table. New-row actions SHALL not be labelled identically to the New Table command. Click destinations SHALL remain unchanged. Enter SHALL open an exact Table's list before considering record hits.

#### Scenario: table_metadata_collision
- **WHEN** searching Table matches the New Table command, Table list, new Table row and Table record
- **THEN** the four destination kinds are distinguishable and Enter opens the Table list

### Requirement: appearance_writes_settle_consistently

Rapid theme or palette selections SHALL remain optimistic without an older completion replacing a newer intent. Once writes settle, the DOM, preference control, user-scoped mirror and cached preference SHALL agree with the last successfully persisted selection. A failed latest write SHALL restore the last confirmed preference; a failed older write SHALL not erase a newer pending selection. Pending completions from an abandoned session SHALL not alter a new session's presentation.

#### Scenario: slow_older_write_then_latest_failure
- **WHEN** Ivory is selected, then Indigo before Ivory completes, and Ivory succeeds but Indigo fails
- **THEN** Indigo remains visible while pending and all client representations finally return to Ivory

#### Scenario: earlier_failure_then_latest_success
- **WHEN** a first theme or palette write fails while a later choice is pending and the later write succeeds
- **THEN** the later choice remains visible and becomes the persisted preference

### Requirement: appearance_text_roles_meet_contrast

All four Admin palettes in light and dark mode SHALL provide independent link, status-text and primary-button foreground/background roles. Links against canvas, surface and subtle backgrounds, status text against those backgrounds and matching status tints, and enabled primary button text in normal and hover states SHALL have WCAG AA contrast of at least 4.5:1. Accent and text roles SHALL be independently tunable.

#### Scenario: palette_mode_role_matrix
- **WHEN** Classic, Ivory, Graphite and Indigo are each rendered in light and dark mode
- **THEN** the affected role pairs meet 4.5:1 including Ivory links/buttons and Indigo success text

### Requirement: builder_warns_beside_dropzone

For multiple parsed sheets, the builder SHALL show an amber warning immediately below the dropzone and before the column grid. It SHALL name the sheet used and every ignored parsed sheet, and link to the Import wizard. Clearing or replacing the file with one sheet SHALL remove the warning. Import behavior SHALL remain first-sheet-only.

#### Scenario: unequal_workbook_sheets
- **WHEN** Zones, Stores and Prices are loaded, then replaced with a single-sheet file
- **THEN** the warning first names Zones as used and Stores and Prices as ignored, and then disappears

### Requirement: source_preview_explains_references

SourceBrowser SHALL expose column names, source types and proposed field types. FK columns SHALL show their schema-qualified source target. A FK to a matching bound key SHALL propose Reference with its Desk target; a FK to a selected bindable target's primary key SHALL show its prospective Reference target. Other FK columns SHALL retain their primitive proposal and explain that the target must be reflected with the matching key. Non-FK and primary-key columns SHALL not be presented as Reference fields. Previewing SHALL not perform reflection.

#### Scenario: fk_targets_are_not_interchangeable
- **WHEN** columns reference a selected target's primary key, a different schema's same-named table, an unselected target and a non-primary column
- **THEN** only eligible edges propose Reference, and every FK retains its distinct qualified target
