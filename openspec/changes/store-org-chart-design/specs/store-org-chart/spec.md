## ADDED Requirements

All examples are synthetic. Stores: **Lakeside (LKS)** with floors Ground, First and
Second, and **Hillview (HVW)** with no floors. People are P-101, P-102 and so on.

### Requirement: A store is shown by its name and code

Every screen that names a store SHALL show its name and its store code, for example
"Lakeside (LKS)". The store's internal plant number SHALL be used only as a key and
never shown.

#### Scenario: Picking a store

- **WHEN** a manager opens the store picker
- **THEN** it lists "Lakeside (LKS)" and "Hillview (HVW)", and no plant numbers

### Requirement: A section is one area of one store, named uniquely in that store

A section SHALL belong to one store and SHALL have a name that is unique within that
store. It SHALL have an optional floor, which must be one of that store's floors, and a
section type of `selling` or `support`, and a `team_leaders_allowed` number that defaults to
1. The same name in two stores SHALL mean two different sections. Moving a section to
another floor SHALL be one edit to its floor, which keeps its job assignments and history
attached. A section SHALL NOT be split into "virtual" sections to give each of its Team
Leaders one of their own: when two Team Leaders genuinely share a section, the section stays
whole and allows 2.

*(Recommended by the instance owner's manager thread, not yet confirmed by the instance
owner: the per-section `team_leaders_allowed` number.)*

#### Scenario: A second section with the same name is refused

- **WHEN** someone adds a section "Women Tops" to LKS, which already has one
- **THEN** the add is refused, naming the existing section

#### Scenario: A store without floors

- **WHEN** HVW's sections are entered with no floor
- **THEN** they are accepted

#### Scenario: Moving a section to another floor

- **WHEN** LKS "Kids Wear" moves from First to Second
- **THEN** only its floor changes, and its Team Leader's job assignment is untouched

### Requirement: Each subcategory has one owning section per store at any date

`section_subcategory` SHALL record, for a store and a subcategory, the section that
owns it from `starts_on` up to but not including `ends_on`. For one store and
subcategory, the periods SHALL NOT overlap. All of the subcategory's sales, stock,
target and coverage SHALL be credited to its owning section on each date. A file that
places one subcategory in two sections of a store for the same date SHALL be flagged as
a conflict, and the import SHALL NOT keep both rows.

#### Scenario: A festive move credits each part of the month correctly

- **WHEN** LKS "Women Scarf" is owned by "Women Tops" until 15-Aug and by "Festive Hall"
  from 15-Aug to 15-Sep
- **THEN** August's target-versus-actual credits Women Tops for 1–14 Aug and Festive
  Hall for 15–31 Aug, including when the report is re-run months later

#### Scenario: Overlapping owners are refused

- **WHEN** someone gives "Women Scarf" at LKS a second owning section for a period that
  overlaps the first
- **THEN** the change is refused, naming the overlapping row

#### Scenario: The same subcategory in different stores

- **WHEN** "Women Scarf" is owned by "Women Tops" at LKS and by "Accessories" at HVW
- **THEN** both rows are accepted

### Requirement: A display location never moves credit

A display location SHALL record an extra place where a subcategory is shown, such as a
billing-counter fixture, for a period. Display locations SHALL NOT change any credit,
target or coverage. They SHALL be listed for floor audits.

#### Scenario: A counter fixture

- **WHEN** "Women Scarf" at LKS is also shown at "Ground Floor billing counter" from
  01-Oct
- **THEN** its sales are still credited only to its owning section
- **AND** the floor audit list shows both places

### Requirement: A job assignment says who holds which job, where and when

A job assignment SHALL record a person, a job, a store, an `acting` flag, `starts_on`
and an optional `ends_on`. `ends_on` is exclusive, and an empty `ends_on` means current.
The job SHALL be one of Store Manager, Floor Manager, Department Manager, Team Leader,
Staff and Cluster Manager. A Floor Manager's row SHALL name one floor of that store. A
Team Leader's or Staff member's row SHALL name one section of that store. Every other
job's row SHALL name neither. A row MAY name a `reports_to` person.

*(Pending the business owner: further jobs for cashiers and assistant titles may be
added to the list.)*

#### Scenario: A Team Leader without a section is refused

- **WHEN** someone saves a Team Leader job assignment for P-101 at LKS with no section
- **THEN** it is refused, saying a Team Leader needs a section

#### Scenario: A Floor Manager over two floors

- **WHEN** P-102 is Floor Manager of LKS Ground and First
- **THEN** P-102 has two job assignments, one per floor

*(Pending the business owner: how each store's Floor Managers map to its floors, and
whether a floor can be shared or split.)*

### Requirement: A handover ends one assignment on the day the next begins

A handover SHALL close the outgoing job assignment and open the incoming one on the
same date, so "who held it on day X?" always has exactly one answer. Future-dated and
back-dated assignments SHALL be allowed, and the edit history SHALL keep every change.

#### Scenario: A Team Leader handover

- **WHEN** P-103 leads LKS "Girls Ethnic" from 01-Jul and P-104 takes over on 06-Aug
- **THEN** P-103's row ends on 06-Aug, P-104's starts on 06-Aug
- **AND** a July report credits P-103, and an August report from the 6th credits P-104

### Requirement: Acting cover is a dated row, and the one-owner rules ignore it

An acting job assignment SHALL be an ordinary dated row with `acting` set. The absent
person's assignment SHALL stay open. A person's coverage SHALL be the union of all their
current assignments, acting included. The rules that limit a section's Team Leaders to its
`team_leaders_allowed` number, and a store to one Store Manager, SHALL ignore acting rows.

#### Scenario: A Floor Manager acts as Store Manager

- **WHEN** P-102, Floor Manager of LKS Ground, acts as LKS Store Manager from 03-Nov to
  17-Nov
- **THEN** P-102 covers the whole of LKS on those dates, and only Ground before and after
- **AND** no conflict is raised for LKS having two Store Managers

### Requirement: Everyone but a Cluster Manager works in one store at a time

A person SHALL NOT hold non-acting or acting job assignments in two different stores
on the same date, unless every overlapping row is a Cluster Manager row. Cover in
another store, and seasonal redeployment between stores, SHALL be recorded as a
handover there and a handover back.

*(Pending the business owner: who is redeployed, who decides, and how long a move
usually lasts.)*

#### Scenario: Seasonal redeployment

- **WHEN** P-105, Staff at HVW, works at LKS from 20-Aug to 10-Sep
- **THEN** the HVW row ends on 20-Aug, an LKS row runs from 20-Aug to 10-Sep, and a new
  HVW row starts on 10-Sep
- **AND** on no date does P-105 hold rows in both stores

#### Scenario: Two stores at once is refused

- **WHEN** someone opens a Staff row for P-105 at LKS while the HVW row is still open
- **THEN** the change is refused, naming the HVW row

#### Scenario: A Cluster Manager covers several stores

- **WHEN** P-106 has Cluster Manager rows at LKS and HVW for the same dates
- **THEN** both are accepted

### Requirement: Coverage is worked out from the org chart, never stored

A person's coverage on a date SHALL be worked out from their job assignments current
on that date:

- Store Manager: every section of the store, including sections that no reporting
  line reaches;
- Floor Manager: the sections on their floors only;
- Department Manager: the sections of the Team Leaders whose current reporting line
  points to them;
- Team Leader and Staff: their section;
- Cluster Manager: each of their stores, in full.

Each covered section brings the subcategories it owns on that date. Feather Dash's
scope provider SHALL return this coverage in the platform's scope shape (B2), and no
coverage SHALL be stored in a table.

#### Scenario: A Department Manager covers through their Team Leaders

- **WHEN** P-107 is a Department Manager at LKS, and the Team Leaders of "Sarees" and
  "Silk Sarees" report to P-107
- **THEN** P-107 covers those two sections
- **WHEN** the "Silk Sarees" Team Leader's reporting line moves to another Department
  Manager
- **THEN** P-107 covers only "Sarees" from that date

#### Scenario: A Floor Manager sees their floor only

- **WHEN** P-102 is Floor Manager of LKS Ground, and a Department Manager whose
  sections are on First reports to P-102
- **THEN** P-102 covers only the Ground sections

#### Scenario: Coverage on a past date

- **WHEN** a July report is re-run in October
- **THEN** each person's coverage is worked out from the assignments current in July

### Requirement: Org-chart conflicts are listed, and never change coverage

Featherbase SHALL list each store's org-chart conflicts, each with its reason. A
conflict SHALL NOT widen or narrow anyone's coverage. The conflicts SHALL include:

- a section with more non-acting Team Leaders than its `team_leaders_allowed` number;
- a Team Leader on more than one section;
- a Team Leader, Department Manager or Floor Manager with no reporting line;
- a section with no Team Leader;
- a Department Manager reporting to a Floor Manager whose floors do not hold that
  Department Manager's sections;
- a subcategory placed in two sections of one store for the same date;
- an imported row that places a subcategory on a floor other than its owning
  section's floor (the fix is to move the subcategory, or to split the area into a
  separately named section).

The Team Leader limit per section, and one section per Team Leader, SHALL be enforced by
the database only once a store's list is empty and the instance owner switches the rule on.

When a section genuinely has two Team Leaders, both SHALL cover the whole section, and each
Staff member SHALL report to one of them.

A section's target SHALL be split equally among its current non-acting Team Leaders
(instance owner, 27-Oct-2026). Coverage is not split: each of them still sees the whole
section.

#### Scenario: A two-Team-Leader section's target is split equally

- **WHEN** LKS "Sarees" allows 2, P-110 and P-111 lead it, and its October target is
  ₹10,00,000
- **THEN** each of them carries a target of ₹5,00,000, and each still sees all of
  "Sarees" 

#### Scenario: More Team Leaders than the section allows

- **WHEN** P-108 and P-109 both hold non-acting Team Leader rows on LKS "Tops", and
  "Tops" allows 1
- **THEN** LKS's conflict list shows "Tops has 2 Team Leaders, allows 1: P-108, P-109"
- **AND** both still cover "Tops"

#### Scenario: A section that genuinely has two Team Leaders

- **WHEN** LKS "Sarees" allows 2, and P-110 and P-111 both hold non-acting Team Leader
  rows on it
- **THEN** no conflict is raised, both cover "Sarees", and each Sarees Staff member reports
  to one of them
- **WHEN** a third person, P-112, is left on "Sarees" after moving to another section
- **THEN** the conflict list shows "Sarees has 3 Team Leaders, allows 2"

#### Scenario: A Department Manager under the wrong Floor Manager

- **WHEN** a Department Manager whose sections are on First reports to the Floor Manager
  of Ground
- **THEN** the conflict list shows the mismatch, and neither person's coverage changes

### Requirement: Other systems' names are aliases that point at real rows

Another system's name for a section, floor or job SHALL be kept in one alias table per
entity, as (source, alias) mapped to the real row:

- `section_alias`: store, source, alias → section;
- `floor_alias`: store, source, alias → floor;
- `job_alias`: source, alias → job.

An alias SHALL point at a row that exists. A designation SHALL match a job alias only as
a whole value, never by a part of it. A value with no alias SHALL appear on one
"needs matching" list, and the rows that carry it SHALL NOT be loaded until it is
matched. A correction to a fact SHALL be an edit to the row, not an override table.

#### Scenario: A spelling variant

- **WHEN** an HR file names LKS floor "Ground floor" and the floor is "Ground"
- **THEN** a `floor_alias` row maps the variant, and the file loads

#### Scenario: A partial match is not a match

- **WHEN** an HR file has the designation "Warehouse - Team Leader" and only "Team Leader"
  has a job alias
- **THEN** "Warehouse - Team Leader" appears on the needs-matching list, and its holders
  get no job assignment

### Requirement: Each store maintains its own org chart through maker-and-checker

Within one store, the Store Manager SHALL be final. This covers the store's tables: the
layout tables, `job_assignment`, `section_alias` and `floor_alias`.
- The Store Manager's own changes to them SHALL apply at once, with no approval step, and
  SHALL be logged with who changed what and when.
- The Store Manager MAY delegate making changes to a Department Manager or Team Leader of
  that store. A delegate's change SHALL wait for that store's Store Manager to approve it.
  Nobody SHALL approve their own change.

Anything outside a single store SHALL be approved by a central authority (an Org Chart
Admin or a System Manager). This covers `job_alias`, Cluster Manager job assignments and
any change that spans stores.

The routes SHALL be approval rules (#627), not code. A rule's outcome is either "apply
and log" or "route to an approver".

#### Scenario: A delegated Team Leader's change waits

- **WHEN** LKS's Store Manager has delegated to P-101, and P-101 moves "Women Scarf" to
  "Festive Hall" from 15-Aug
- **THEN** the placement is unchanged until the Store Manager approves it

#### Scenario: A Store Manager's own change applies at once and is logged

- **WHEN** LKS's Store Manager moves "Women Scarf" to "Festive Hall" from 15-Aug, or
  records a Team Leader handover at LKS
- **THEN** the change applies at once, with no approval step
- **AND** the history shows the Store Manager as its author, with the time

#### Scenario: A store cannot redefine a job

- **WHEN** LKS's Store Manager tries to add a `job_alias` row
- **THEN** it is refused, because job aliases are central

### Requirement: An HR re-import keeps a person's correction

An import from an HR system or a store workbook SHALL update only fields that no person
has edited since. A field that a person edited and the source changed SHALL keep the
person's value and appear on the import conflict list (#626).

#### Scenario: A corrected reporting line survives

- **WHEN** a Store Manager corrects P-101's reporting line, and the next HR import still
  names the old manager
- **THEN** P-101's reporting line keeps the correction, and the import conflict list
  shows both values

### Requirement: Each store moves off the old sheets when its lists are empty

The preparation script's rows SHALL load marked "not live yet" for their store. Reports
SHALL keep reading the old roster sheets for a store until that store switches live. A
store SHALL switch live only when its org-chart conflict list and its needs-matching list
are empty. Before it does, each person's coverage SHALL be compared, old against new,
and every difference listed with its reason. Stores SHALL switch one at a time, in any
order.

#### Scenario: One store goes first

- **WHEN** LKS's lists are empty and its coverage comparison is accepted
- **THEN** LKS switches live and its reports read the new tables
- **AND** HVW's reports still read the old sheets

#### Scenario: A store with open conflicts cannot switch

- **WHEN** HVW's conflict list still has one row
- **THEN** switching HVW live is refused, naming the open row

### Requirement: People can see the store org chart and their own coverage

Feather Dash SHALL have a Store org chart page that shows, for a store a person covers,
the tree from Store Manager down to Staff, each person's coverage (store, floors or
sections), and the store's conflict and needs-matching lists. Each person's coverage
SHALL also reach the platform's "What can this person see, and why" page (#628), with
the job assignment as the reason.

#### Scenario: A Team Leader checks their coverage

- **WHEN** P-104 opens "What can this person see, and why" for themselves
- **THEN** it lists "LKS Girls Ethnic — Team Leader job assignment from 06-Aug"
