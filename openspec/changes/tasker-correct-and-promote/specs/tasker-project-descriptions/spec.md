# Project Descriptions

## Purpose

A project can carry a short shared description of what it is for, so everyone
working in it starts from the same understanding.

## ADDED Requirements

### Requirement: Describe a project

Each project SHALL be able to have a description that the whole team sees
under its name, written in Markdown, a simple way to add links, lists and
code, and never taking the user out of the project to read or edit. A project
without one offers to add it; editing is deliberate, with save and cancel —
saving empty clears it, cancelling saves nothing.

#### Scenario: Share a project's purpose

- **WHEN** the user saves the description "Count every shelf before the 30th" on a project
- **THEN** Shahul sees the same description on that project
- **AND** when the user later clears it and saves, the project offers to add a description again

### Requirement: A description edit is never lost or overwritten

If someone else changed the project after the user started editing its
description, the save SHALL be refused and the user's draft kept.

#### Scenario: Someone else saved first

- **WHEN** the user starts editing a project's description, Shahul changes the same project, and the user then saves
- **THEN** the user is told the project has changed and Shahul's change stays

### Requirement: Descriptions cannot run code

Descriptions SHALL show ordinary formatting, but nothing written into them can
run: embedded web page code is ignored and links cannot run scripts.

#### Scenario: Harmful content stays harmless

- **WHEN** the user writes a description containing a script and a link that tries to run code
- **THEN** the description is shown and nothing in it runs
