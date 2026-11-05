# Access Explanation

## Purpose
Anyone asking "why can this person see that?" gets the answer on one page
per person: what they can see and the reason for each item, without reading
the database and without the page showing any of the data itself.

## Requirements

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

### Requirement: The page never shows data the viewer cannot read

The page SHALL show that access exists and why, never the data itself. A row
named on the page SHALL show its title only when the viewer can read that row;
otherwise it SHALL show only its Table and id.

#### Scenario: A limit to a row the person cannot read

- **WHEN** a person is limited by a Data Scope row to the Site with id "N1",
  titled "North", cannot read the Table "Site", and opens their own page
- **THEN** the limit shows as Site "N1", without the title "North"

### Requirement: Who may open a person's page

A person SHALL be able to open their own page. A System Manager or a holder of
the built-in Access Auditor role SHALL be able to open anyone's. A viewer
whose places, as the instance's scope provider gives them, cover every place
of the person SHALL be able to open that person's page. A person with no
places SHALL never be covered. Anyone else SHALL be refused, before anything
says whether the person exists.

#### Scenario: An Access Auditor opens anyone's page

- **WHEN** a holder of Access Auditor asks for a colleague's page
- **THEN** the page is shown

#### Scenario: A manager opens the page of a person in their places

- **GIVEN** a manager whose places cover store N1, kids and mens
- **AND** a person whose one place is store N1, kids
- **WHEN** the manager asks for the person's page
- **THEN** the page is shown

#### Scenario: A person with a place outside the manager's is refused

- **GIVEN** a person with places in store N1 and store S1
- **AND** a manager whose places cover only store N1
- **WHEN** the manager asks for the person's page
- **THEN** the request is refused

#### Scenario: A person with no places is never covered

- **WHEN** someone other than a System Manager or an Access Auditor asks for
  the page of a person with no places
- **THEN** the request is refused

#### Scenario: A colleague is refused

- **WHEN** a person who is neither a System Manager, an Access Auditor nor
  someone whose places cover the colleague's asks for a colleague's page
- **THEN** the request is refused, and nothing about the colleague's access is
  shown
