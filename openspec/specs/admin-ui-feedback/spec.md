# Admin UI Feedback Specification

## Purpose

Admin UI Feedback covers Admin behavior that doesn't belong to a more
specific capability: how the search bar opens what it matches, how a user's
theme follows them, and how turning on a data source's
table completes its foreign keys into References. Building a table from a
dropped file is covered by Tables and Fields; recent search history and
Explore are covered by Search and Explore; language preference is covered by
Personal Preferences; and browsing what a data source holds is covered by
External Data Sources.

## Requirements

### Requirement: The search bar opens what it finds

Searching from anywhere in the Admin SHALL offer the Tables, commands and
records that match, plus a way to start a new row in a matching Table, and
opens whichever one the user picks.

#### Scenario: A record and a Table both match

- **WHEN** a user searches a record's name and then a Table's name
- **THEN** picking the record opens its form, and picking the Table's
  new-row result opens a blank form for that Table

### Requirement: Theme and colour palette follow the user, not the device

Choosing a theme or colour palette SHALL apply it right away and save it to
the user's own account, so it's there again the next time they sign in on
any device — without ever showing another account's choice on a shared
browser.

#### Scenario: Two choices, two accounts

- **WHEN** a user picks Ivory and dark mode and then reloads the page
- **THEN** both choices are still active, and signing in as a different
  user shows that user's own theme and palette instead

### Requirement: Turning on a source table completes matching foreign keys into References

When a builder turns one of a data source's tables into a Featherbase
table, a column the source declares as a foreign key SHALL become a
Reference once its target table has also been turned on with a matching id
column — whichever of the two tables is turned on first.

#### Scenario: The target arrives after the child

- **WHEN** a table is turned on before the table its foreign key points to,
  and that target is turned on afterwards
- **THEN** the first table's column becomes a Reference to the target once
  it arrives, with no need to turn the first table on again

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

SourceBrowser SHALL expose column names, source types and proposed field types. FK columns SHALL show their schema-qualified source target. A FK to a matching bound key SHALL propose Reference with its Admin target; a FK to a selected bindable target's primary key SHALL show its prospective Reference target. Other FK columns SHALL retain their primitive proposal and explain that the target must be reflected with the matching key. Non-FK and primary-key columns SHALL not be presented as Reference fields. Previewing SHALL not perform reflection.

#### Scenario: fk_targets_are_not_interchangeable
- **WHEN** columns reference a selected target's primary key, a different schema's same-named table, an unselected target and a non-primary column
- **THEN** only eligible edges propose Reference, and every FK retains its distinct qualified target
