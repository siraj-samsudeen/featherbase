# Basic Todos

## Purpose

Give people a shared, persistent list of work that they can create, read, rename and delete without signing in.

## ADDED Requirements

### Requirement: Manage a shared Todo list

The application MUST let users create, list, read, rename and delete Todos through a browser and JSON HTTP API. Each Todo MUST have a stable identity and a text title. Duplicate titles MUST be allowed with separate identities. Renaming MUST preserve identity; deletion MUST remove only the selected record. Titles MUST display as text, never executable markup.

This release does not introduce custom title rules, priorities, completion, Projects, conflict handling or retry workflows. Native request parsing and safe data access remain necessary.

#### Scenario: Create and edit work
- **WHEN** I add two Todos titled `Buy milk`, rename one to `Buy bread`, and delete the other
- **THEN** only the renamed Todo remains, with its original identity, and unrelated Todos are unchanged.

### Requirement: Keep saved work

PostgreSQL MUST hold saved Todos. Success MUST mean the database write has completed. Reloading, opening another browser session or restarting the application against the same database MUST preserve saved identities, titles and deletions. Startup MUST NOT reset or overwrite user data.

#### Scenario: Return to the list
- **WHEN** I save changes, delete a Todo, reload and restart the application
- **THEN** the same saved changes remain and the deleted Todo does not return.
