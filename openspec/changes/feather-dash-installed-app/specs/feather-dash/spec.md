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

### Requirement: Ask to correct your own section data

A manager SHALL be able to ask for a change to the data of a section they are
responsible for: confirm the section's list, move a subcategory into or out of it, add
or end a staff member's placement in it, or correct its details. A request about a
section outside their responsibility SHALL be refused. A request changes nothing until
it is reviewed.

#### Scenario: A Team Leader reports a misplaced subcategory

- **WHEN** a Team Leader asks for a subcategory to be moved out of their section, giving
  a reason
- **THEN** the request waits for review and the section is unchanged meanwhile

#### Scenario: Another Team Leader's section is out of reach

- **WHEN** a Team Leader asks for a change to a section someone else leads
- **THEN** the request is refused

### Requirement: A reviewer applies or rejects each request

A reviewer SHALL see every open request and apply or reject it. The reviewer SHALL be
someone given that job, not an instance administrator by default. Applying a request
SHALL change the section data, keep a record of who changed what and when, and survive
later imports of the same data.

#### Scenario: An applied move shows in both sections

- **WHEN** a reviewer applies a request to move a subcategory between two sections
- **THEN** both sections' reports reflect the move on their next opening
- **AND** the request shows who applied it and when

### Requirement: See whether your section data is confirmed

Every section and subcategory a manager sees SHALL show whether it is confirmed or still
assumed, together with any open request about it.

#### Scenario: A manager sees what still needs confirming

- **WHEN** a Store Manager looks at their store's sections
- **THEN** they can tell which sections are confirmed and which are only assumed
