# Project Descriptions

## Purpose

A project can carry a short shared description of what it is for, so everyone
working in it starts from the same understanding.

## ADDED Requirements

### Requirement: Describe a project

Each project SHALL be able to have a description that the whole team sees under
its name, written in Markdown, a simple way to add links, lists and code. A
project without a description offers to add one. Editing is deliberate, with
save and cancel: saving an empty description clears it, and cancelling saves
nothing. If someone else changed the project after the user started editing,
the save is refused and the draft is kept. Reading or editing a description
never takes the user out of the project, on a desktop or a phone.

#### Scenario: Share a project's purpose

- **WHEN** the user saves the description "Count every shelf before the 30th" on a project
- **THEN** Shahul sees the same description on that project
- **AND** when the user later clears it and saves, the project offers to add a description again

#### Scenario: Someone else saved first

- **WHEN** the user starts editing a project's description, Shahul changes the same project, and the user then saves
- **THEN** the user is told the project has changed and Shahul's change stays

### Requirement: Descriptions cannot run code

Descriptions SHALL show ordinary formatting, but nothing written into them can
run: embedded web page code is ignored and links cannot run scripts. Long
content stays readable on a phone without the page scrolling sideways.

#### Scenario: Harmful content stays harmless

- **WHEN** the user writes a description containing a script and a link that tries to run code
- **THEN** the description is shown and nothing in it runs
