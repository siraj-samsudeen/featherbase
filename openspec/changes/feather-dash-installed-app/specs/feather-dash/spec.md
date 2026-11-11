# Feather Dash

## ADDED Requirements

### Requirement: Open your own sales-target report

A manager SHALL open a sales-target report that covers exactly the stores and sections
they are responsible for today, worked out afresh every time they open it. A change to
their responsibilities SHALL show on their next opening without anything being rebuilt.

#### Scenario: A handover takes effect on the next opening

- **WHEN** a section is handed from one Team Leader to another and the new Team Leader
  opens the report
- **THEN** the report covers that section for the new Team Leader
- **AND** the previous Team Leader's next opening no longer covers it

### Requirement: Look at one of your stores at a time

A manager responsible for several stores SHALL choose which of their stores the report
shows. Asking for any other store SHALL be refused.

#### Scenario: Another manager's store is refused

- **WHEN** a manager changes the report's address to ask for a store that is not one
  of theirs
- **THEN** nothing from that store is shown

### Requirement: Numbers show at once, and live numbers wait for the reader

When the report has a recent copy of the numbers, it SHALL show that copy at once,
labelled with when it was refreshed. When current numbers arrive, the report SHALL
offer them and switch only when the reader chooses. Only one set of numbers SHALL show
at a time.

#### Scenario: Live numbers arrive while a manager is reading

- **WHEN** a manager is reading the recent copy and the current numbers arrive
- **THEN** the report tells them current numbers are ready and keeps showing what they
  are reading
- **AND** it switches to the current numbers only when they ask

### Requirement: Every set of numbers says how fresh it is

The report SHALL say, in the same words for the recent copy and the current numbers,
up to which day the data runs and when it was fetched.

#### Scenario: A manager checks how old the numbers are

- **WHEN** a manager looks at either set of numbers
- **THEN** they can see the last day the data covers and when it was fetched

### Requirement: An empty report says why

When the report cannot show figures, it SHALL say why: the person has no sections, the
day's data has not arrived, or the report could not be reached. It SHALL never show
the gap as zero sales.

#### Scenario: Before the morning data arrives on the first of the month

- **WHEN** a manager opens the report early on the first day of a month, before that
  day's data has loaded
- **THEN** the report says the month's data has not arrived yet, instead of showing
  zero

### Requirement: Propose a correction to your own section

A person SHALL see their jobs' sections and subcategories, and SHALL be able to
propose, within their own store, a subcategory's move out of their section, a missing
subcategory joining it, or a different section for their job. A proposal outside
their own job and store SHALL be refused, and SHALL change nothing until approved.

(11-Nov-2026: trimmed to what is built (owner). No Section Editor or Reviewer role,
no reviewer page.)

#### Scenario: A Team Leader reports a misplaced subcategory

- **WHEN** a Team Leader proposes that a subcategory in their section belongs in
  another section of their store
- **THEN** the proposal waits for their manager and the placement is unchanged
  meanwhile

#### Scenario: Another store's section is out of reach

- **WHEN** a Team Leader proposes a move into a section of another store
- **THEN** the proposal is refused

### Requirement: Undo withdraws your own pending proposal

Until a proposal is decided, the person who asked SHALL be able to withdraw it (Undo).
A withdrawn proposal SHALL change nothing and SHALL no longer wait for anyone.

#### Scenario: Undo withdraws a pending proposal

- **WHEN** the Team Leader withdraws their pending proposal before it is decided
- **THEN** it changes nothing and no longer waits for their manager

### Requirement: The job's manager decides, or else a Master Data Editor

A proposal SHALL go to the manager the job reports to, while that manager is current
staff with a sign-in that Dash opens for; otherwise it SHALL go to a Master Data
Editor. Nobody SHALL decide their own proposal, and a System Manager SHALL NOT decide
one by being a System Manager.

#### Scenario: No manager who can sign in

- **WHEN** a person's manager has no sign-in
- **THEN** a Master Data Editor sees the proposal and may decide it

### Requirement: A decision changes the section data only when approved

A rejection SHALL need a reason and change nothing. An approval SHALL write the change
dated that day and record who decided and when. If what was proposed has changed
since, the proposal SHALL need a fresh review and change nothing.

#### Scenario: An approved move starts today

- **WHEN** the manager approves a proposal to move a subcategory to another section
- **THEN** the old placement ends and a new one in the other section starts today
- **AND** the proposal records who decided it and when
