# Project Milestones

## Purpose

Give Projects a small list of significant outcomes, built through the same declarative framework that powers Todos and Projects.

## ADDED Requirements

### Requirement: Manage Milestones within a Project

Users MUST create, list, read, rename and delete Milestones. Each Milestone MUST have a stable ID, a title following the existing Project title rules and a required Project reference. It MUST appear in its Project's Milestones list. Missing Project references and deletion of a Project with Milestones MUST be rejected without losing records. Existing Projects MUST start with no Milestones.

Scheduling, due dates, assignments and linking Todos to Milestones are not part of this initial Milestone feature.

#### Scenario: Add a Project outcome
- **WHEN** I add `First release` to Project A and rename it to `Public release`
- **THEN** it keeps its identity, appears only in A's Milestones, survives restart, and does not alter A's Todos.
- **WHEN** I delete A while it has Milestones
- **THEN** deletion is rejected until those Milestones are removed.

### Requirement: Build Milestones using the framework

Milestones MUST be introduced using resource and presentation declarations, with named extensions only for behavior the declarative vocabulary cannot express. Adding Milestones MUST NOT require core edits or copied controllers, clients, forms or lists. Its API MUST follow the existing generated-contract and runtime-validation requirements, and its UI MUST follow the existing keyboard and feedback conventions.

#### Scenario: Activate Milestones
- **WHEN** the Milestone definition is migrated and activated on the existing framework build
- **THEN** the new API and interface work while Todo and Project data and behavior remain unchanged.
