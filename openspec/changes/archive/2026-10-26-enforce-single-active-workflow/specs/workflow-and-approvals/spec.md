# Spec Delta

## ADDED Requirements

### Requirement: Only one workflow governs a Table

A Table SHALL have at most one active workflow, including when users activate alternatives at the same time. A conflicting save SHALL be refused with the existing active workflow's name, rather than choosing whichever workflow was edited most recently.

#### Scenario: Save a competing workflow

- **WHEN** the user saves a second active workflow for a Table that already has one
- **THEN** the save is refused and names the existing active workflow
- **AND** the existing workflow continues to govern the Table

#### Scenario: Activate alternatives at the same time

- **WHEN** the user and another administrator activate different workflows simultaneously for a Table with no active workflow
- **THEN** only one activation succeeds
- **AND** the refused activation names the workflow that became active

### Requirement: Switch workflows explicitly

The user SHALL be able to keep inactive alternatives and switch to one by deactivating the current workflow first. Different Tables SHALL be able to have their own active workflows independently.

#### Scenario: Keep an alternative and switch to it

- **WHEN** the user saves an inactive alternative, deactivates the current workflow, and activates the alternative
- **THEN** each save succeeds and the alternative governs the Table

#### Scenario: Activate workflows for separate Tables

- **WHEN** the user activates a workflow for each of two different Tables
- **THEN** both activations succeed and each workflow governs its own Table
