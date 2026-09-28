# Organize project work

## Purpose

Help people group Todos into Projects and distinguish open work from completed work without losing existing tasks.

## ADDED Requirements

### Requirement: Organize Todos into Projects

Users MUST create, list, read, rename and delete Projects with stable identities and titles. A Todo MUST belong to at most one Project and can be assigned, reassigned or unassigned. Existing Todos MUST become unassigned. Missing Project references and deletion of a referenced Project MUST be rejected without changing either record. The UI MUST offer all Projects, a selected Project and unassigned Todos as list scopes.

#### Scenario: Move work between Projects
- **WHEN** I move a Todo from Project A to B
- **THEN** its identity, title and priority remain intact; it appears under B, A can be deleted, and deleting B is rejected until its Todos are removed or unassigned.

### Requirement: Complete and filter work

Todos MUST be completable and reopenable. Existing and newly created Todos MUST start open. The list MUST offer All, Open and Completed, initially All, combined with the Project scope. Filtering MUST not modify data. A saved change MUST immediately update visible membership. Empty results MUST be distinguishable from loading and failure.

#### Scenario: Finish a task
- **WHEN** I complete the last open Todo while viewing Open in Project A
- **THEN** that view becomes empty and the Todo appears in Completed for A, without changing work in other Projects.

### Requirement: Use valid titles

Todo and Project creation and renaming MUST trim Unicode White_Space at either end and preserve internal spacing, case and Unicode composition. Titles MUST contain 1–200 Unicode code points after trimming and no internal U+000A, U+000D, U+0085, U+2028 or U+2029. Rejection MUST preserve draft input and saved data. Titles remain plain text. Upgrading existing invalid titles MUST report the affected records and require correction rather than silently rewrite or delete them.

#### Scenario: Correct a title
- **WHEN** I submit a blank title, an internal line break or 201 code points
- **THEN** nothing is saved and I can correct my input.
- **WHEN** I submit `  Buy  milk  ` or a valid 200-code-point title containing emoji
- **THEN** the trimmed title is saved without changing its internal text.
