# Assignments, Tags and Rules

## Purpose

A row can be handed to a person to work on, labelled freely with tags to
group and find later, and — for the rows that match a rule — handed out on
its own, spreading the work evenly across a pool of people. An administrator
can also attach a short script to a Table to check or fill in its rows as
they are saved.

## Requirements

### Requirement: Assign a row to someone

Anyone who can read a row and whose role lets them assign work SHALL be
able to assign it to a person; a person who doesn't exist SHALL be refused. Assigning
it SHALL add it to that person's own list of what's assigned to them and
notify them (see Notifications, Email and Webhooks), and a row SHALL be
assignable to more than one person at once.

#### Scenario: Assign a row

- **WHEN** the user assigns a row to Priya
- **THEN** it appears on Priya's own list of assignments

#### Scenario: Assign to two people

- **WHEN** the user assigns the same row to Alex and then to Priya
- **THEN** it appears on both of their lists

#### Scenario: A row the user can't read

- **WHEN** a user who cannot read a row tries to assign it
- **THEN** it is refused and no one is assigned

### Requirement: Tag a row freely

Anyone who can read a row SHALL be able to add or remove its tags, and
tags SHALL be visible to anyone else who can read that row.

#### Scenario: Add and remove a tag

- **WHEN** the user tags a row "urgent" and later removes that tag
- **THEN** the tag shows on the row until removed, and is gone afterward

#### Scenario: Another reader sees and removes it

- **WHEN** one person tags a row and another person who can read it opens it
- **THEN** the second person sees the tag and can remove it

#### Scenario: A row the user can't read

- **WHEN** a user who cannot read a row tries to see or add its tags
- **THEN** they are refused

### Requirement: Auto-assign new rows with a rule

The user SHALL be able to set up a rule that, whenever a new row of a
chosen kind matches an optional condition, assigns it to the next person in
a chosen pool, cycling through the pool in turn. Turning the rule off SHALL
stop it assigning anyone.

#### Scenario: A rule spreads new rows across a pool

- **WHEN** two new support tickets are created in a row and a rule pools
  Alex and Priya for tickets
- **THEN** the first ticket is assigned to Alex and the second to Priya

#### Scenario: A rule records who got the row

- **WHEN** a rule is set to record the assignee in a ticket's agent field and
  a new ticket matches it
- **THEN** the ticket's agent field shows the person it was assigned to

#### Scenario: A row that doesn't match

- **WHEN** a new ticket doesn't meet the rule's condition
- **THEN** no one is assigned to it

#### Scenario: A disabled rule assigns no one

- **WHEN** a matching row is created while its assignment rule is turned
  off
- **THEN** no one is assigned to it

#### Scenario: An edited row doesn't trigger the rule

- **WHEN** an existing row is edited so that it now matches a rule's
  condition
- **THEN** the rule does not assign it — only newly created rows are
  considered

### Requirement: Check or fill in a row with a script

An administrator SHALL be able to attach a short script to a Table that runs
whenever one of its rows is saved. It can refuse the save with its own
message or fill in fields, and a script that is switched off does nothing.

#### Scenario: Refuse a bad amount

- **WHEN** a script refuses negative amounts and the user saves a row with an
  amount of minus one
- **THEN** the save is refused with the script's message
- **AND** a row with a positive amount saves normally

#### Scenario: Fill in a field

- **WHEN** a script labels rows over 100 as "big" and the user saves a row
  with an amount of 200
- **THEN** the saved row is labelled "big"

#### Scenario: A script switched off

- **WHEN** a script that would refuse every save is switched off
- **THEN** saves go through

### Requirement: A script cannot reach beyond its row

A script SHALL work only on the row or details it is given. It SHALL NOT
reach the server's files, network or settings, and a script that runs too
long SHALL be stopped and its save refused.

#### Scenario: A script that reaches for the server

- **WHEN** a script tries to read a file or call another site
- **THEN** the save is refused with an error

#### Scenario: A script that never ends

- **WHEN** a script loops forever
- **THEN** it is stopped and the save is refused

### Requirement: A script can answer when called by name

An administrator SHALL be able to define a script that other parts of the
system call by name with some details and that sends back an answer. A name
with no enabled script SHALL be refused as not found.

#### Scenario: Call a script by name

- **WHEN** a script that doubles a number is called with 4
- **THEN** the answer is 8

#### Scenario: An unknown name

- **WHEN** something calls a script name nobody defined
- **THEN** it is told there is no such script
