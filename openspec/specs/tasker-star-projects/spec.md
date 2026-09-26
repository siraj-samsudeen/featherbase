# Star Projects

## Purpose

Each person can star the projects they use most so they appear as tabs for quick
switching. Stars are private: starring a project changes nothing for anyone
else.

## Requirements

### Requirement: Starred projects become personal tabs

Starring a project SHALL add it to the user's own row of project tabs, and
unstarring removes only that user's tab. The user can reorder their tabs, and
the tabs and their order are kept across reloads and devices.

#### Scenario: Each person keeps their own tabs

- **WHEN** Siraj stars "Warehouse review" and "Store opening" and moves "Store opening" first, while Shahul stars only "Warehouse review"
- **THEN** after a reload Siraj's tabs are "Store opening" then "Warehouse review"
- **AND** Shahul's only tab is "Warehouse review"

### Requirement: Tabs for missing projects disappear

If a starred project is deleted or can no longer be opened, its tab SHALL
disappear without breaking the others, which keep their order.

#### Scenario: A starred project is deleted

- **WHEN** the user has three starred projects and the middle one is deleted
- **THEN** the user's tabs show the other two, in their original order
