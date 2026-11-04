## ADDED Requirements

### Requirement: A page says what a person can see, and why

Each person SHALL have a page listing what they can see, grouped as roles,
Tables reached, Data Scope rows and rows shared with them, each item with its
reason. A role SHALL say who gave it and when, where history records it. A
Table SHALL say whether it can be read or changed, whether only for the
person's own rows, and which of the person's roles grant it. A person who is a
System Manager SHALL be shown as reaching every Table.

#### Scenario: Roles and the Tables they reach

- **WHEN** a System Manager gives a person the role "Plant Reader", which may
  read the Table "Plant", and opens that person's page
- **THEN** the page lists the role "Plant Reader", given by that System
  Manager, and lists "Plant" as readable through "Plant Reader"

#### Scenario: Limited to some rows, and a row shared directly

- **WHEN** the person has a Data Scope row limiting them to Site "North", and
  a colleague has shared one row of "Plant" with them
- **THEN** the page lists the limit to Site "North" with who set it and when,
  and the shared row with who shared it, when, and whether it may be changed

### Requirement: Only the person and System Managers open the page

A person SHALL be able to open their own page. A System Manager SHALL be able
to open anyone's. Anyone else SHALL be refused.

#### Scenario: A colleague is refused

- **WHEN** a person without the System Manager role asks for a colleague's page
- **THEN** the request is refused, and nothing about the colleague's access is
  shown

### Requirement: The page never shows data the viewer cannot read

The page SHALL show that access exists and why, never the data itself. A row
named on the page SHALL show its title only when the viewer can read that row;
otherwise it SHALL show only its Table and id.

#### Scenario: A limit to a row the person cannot read

- **WHEN** a person is limited by a Data Scope row to the Site with id "N1",
  titled "North", cannot read the Table "Site", and opens their own page
- **THEN** the limit shows as Site "N1", without the title "North"
