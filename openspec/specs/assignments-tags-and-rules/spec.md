# Assignments, Tags and Rules

## Purpose

A row can be handed to a person to work on, labelled freely with tags to
group and find later, and — for the rows that match a rule — handed out on
its own, spreading the work evenly across a pool of people.

## Requirements

### Requirement: Assign a row to someone

The user SHALL be able to assign a row to a person. Assigning it SHALL add
it to that person's own list of what's assigned to them and notify them,
and a row SHALL be assignable to more than one person at once.

#### Scenario: Assign a row

- **WHEN** the user assigns a row to Priya
- **THEN** it appears on Priya's own list of assignments
- **AND** Priya is notified

### Requirement: Tag a row freely

Anyone who can read a row SHALL be able to add or remove its tags, and
tags SHALL be visible to anyone else who can read that row.

#### Scenario: Add and remove a tag

- **WHEN** the user tags a row "urgent" and later removes that tag
- **THEN** the tag shows on the row until removed, and is gone afterward

### Requirement: Auto-assign new rows with a rule

The user SHALL be able to set up a rule that, whenever a new row of a
chosen kind matches an optional condition, assigns it to the next person in
a chosen pool, cycling through the pool in turn. Turning the rule off SHALL
stop it assigning anyone.

#### Scenario: A rule spreads new rows across a pool

- **WHEN** two new support tickets are created in a row and a rule pools
  Alex and Priya for tickets
- **THEN** the first ticket is assigned to Alex and the second to Priya

#### Scenario: A disabled rule assigns no one

- **WHEN** a matching row is created while its assignment rule is turned
  off
- **THEN** no one is assigned to it

#### Scenario: An edited row doesn't trigger the rule

- **WHEN** an existing row is edited so that it now matches a rule's
  condition
- **THEN** the rule does not assign it — only newly created rows are
  considered
