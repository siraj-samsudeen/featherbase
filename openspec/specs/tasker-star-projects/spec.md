# Star Projects for Quick Access

## Purpose

A team member can keep frequently used projects in a personal order and switch
to them quickly without changing the shared projects.

## Requirements

### Requirement: project_tabs_are_private_ordered

Starring SHALL add a project to the current person's ordered quick-access list.
Unstarring SHALL remove only that person's shortcut. The order SHALL survive
reload. Only starred projects SHALL appear as persistent workspace tabs. Star
and tab-order controls SHALL live in the selected project workspace, have
visible labels and work by keyboard; they SHALL NOT appear in the project
directory.

#### Scenario: frequent_project_switching
- **WHEN** one member stars and orders two projects while another stars only one
- **THEN** each member sees only their own quick-access projects and order.

### Requirement: stale_project_tabs_self_heal

Missing or unreadable projects SHALL be omitted and removed on the next
preference write without disturbing the readable order.

#### Scenario: stale_project_reference
- **GIVEN** one saved project reference is unavailable between two readable ones
- **WHEN** Tasker loads the quick-access list
- **THEN** the readable projects remain in order
- **AND** the unavailable reference is dropped on the next preference write.
