## ADDED Requirements

### Requirement: Recent and frequent destinations offer only rows that still exist

The sidebar's recently opened and frequent destinations, and the command
bar's recent and frequent groups, SHALL offer only remembered rows that still
exist and that the user can read. The user's history SHALL be kept; a
destination left out frees its place for the next one remembered.

#### Scenario: A deleted row is no longer offered

- **WHEN** the user opened the rows "Kept bin" and "Deleted bin", and
  "Deleted bin" was then deleted
- **THEN** the sidebar and the command bar offer "Kept bin" and not
  "Deleted bin"

#### Scenario: A row deleted from its form leaves at once

- **WHEN** the user opens "Deleted bin" and deletes it from its form
- **THEN** the sidebar stops offering it without a reload, and still offers
  "Kept bin"
