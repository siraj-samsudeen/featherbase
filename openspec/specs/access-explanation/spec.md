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

### Requirement: The page lists the places an app gives the person, with reasons

When an app provides people's scope, the page SHALL list each place it gives
the person today, by its label, with the reasons the app gives for it and the
days each reason holds from and to where the app knows them. A place the app
gives no reason for SHALL say so. The page SHALL never show a place's filter
values. When the app gives the person no places, the page SHALL say why: it
is not set up yet, it could not answer, or it gives them none.

#### Scenario: A place with a dated reason

- **GIVEN** the scope app places a person in South / Mens because of a Team
  Leader job assignment from 6 Aug 2026
- **WHEN** someone who may open the person's page opens it
- **THEN** it lists "South / Mens — Team Leader job assignment from
  06-Aug-2026"

#### Scenario: A place with no reason

- **GIVEN** the scope app places a person in North / Kids and gives no reason
- **WHEN** the page is opened
- **THEN** it lists "North / Kids — no reason given by" the app

#### Scenario: The app is not set up yet

- **GIVEN** the scope app needs an identifier system the instance lacks
- **WHEN** the page is opened
- **THEN** it says the app is not set up yet, and still shows the person's
  roles, Tables, limits and shares

### Requirement: The page keeps the frame the person came from

Someone who can use Admin, on an address that holds Admin, SHALL read their account pages, this one included, in the Admin frame with its sidebar, app switcher and command bar. Someone who can't use Admin, and anyone on an app's own address, SHALL keep the plain top bar.

#### Scenario: A System Manager opens What can I see?

- **WHEN** a System Manager opens **What can I see?** from the account menu in Admin
- **THEN** the page has the Admin sidebar and command bar

#### Scenario: Someone without Admin

- **WHEN** someone who can't use Admin opens their own page
- **THEN** it has the plain top bar and no Admin sidebar

### Requirement: A person's own page says "you"

On a person's own page every section SHALL address them as "you". On someone else's page the sections SHALL say "they" and "them".

#### Scenario: Your own page

- **WHEN** a person reads their own page
- **THEN** the sections read "Tables you reach" and "Shared with you"

#### Scenario: Someone else's page

- **WHEN** a System Manager reads another person's page
- **THEN** the sections read "Tables they reach" and "Shared with them"
