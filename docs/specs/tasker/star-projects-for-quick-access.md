# Star Projects for Quick Access

**IDs:** `project_tabs_are_private_ordered` · `stale_project_tabs_self_heal`

## Purpose

A team member can keep frequently used projects in a personal order and switch
to them quickly without changing the shared projects.

### Requirement: project_tabs_are_private_ordered
Status: governed (#296)

> evidence: proven via project_coordination_flow — two users retain different project preferences while one reorders and opens quick tabs.

Starring SHALL add a project to the current person's ordered quick-access list.
Unstarring SHALL remove only that person's shortcut. The order SHALL survive
reload. Star and reorder controls SHALL have visible labels and work by keyboard.

#### Scenario: frequent_project_switching

- **WHEN** one member stars and orders two projects while another stars only one
- **THEN** each member sees only their own quick-access projects and order.

### Requirement: stale_project_tabs_self_heal
Status: governed (#296)

> evidence: gap — Tasker filters stale project ids and the next write uses the filtered list, but no dedicated test proves the full behavior.

Missing or unreadable projects SHALL be omitted and removed on the next
preference write without disturbing the readable order.

#### Scenario: stale_project_reference

- **GIVEN** one saved project reference is unavailable between two readable ones
- **WHEN** Tasker loads the quick-access list
- **THEN** the readable projects remain in order
- **AND** the unavailable reference is dropped on the next preference write.
