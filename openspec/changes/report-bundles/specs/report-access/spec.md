# Report Access

## ADDED Requirements

### Requirement: A person sees only the reports given to them
A person SHALL see the union of the reports given to them directly, through a role they hold, through the job on their current Job Assignment, and through any bundle given by those routes. Nothing SHALL withhold a report. With no such row a person SHALL see no report, whether or not they are a System Manager. The answer SHALL be read fresh on every request.

#### Scenario: Someone with no assignment sees nothing

- **WHEN** Asha, who has no report given to her, opens Dash
- **THEN** she gets the no-access page, and she shows as waiting for access

#### Scenario: A System Manager gets no automatic access

- **WHEN** Sam, a System Manager with no report given to him, asks for his reports
- **THEN** none are listed

#### Scenario: Each route gives a report

- **WHEN** "Stock ageing" is given directly to Asha, the bundle "Team leader pack" holds "Sales to date" and is given to the job Team Leader, and Asha's current job is Team Leader
- **THEN** Asha's reports are "Stock ageing" and "Sales to date"

#### Scenario: Removing a row takes effect on the next request

- **WHEN** the row giving "Stock ageing" directly to Asha is removed
- **THEN** Asha's next request does not list "Stock ageing"

#### Scenario: Losing a role takes effect on the next request

- **WHEN** "Stock ageing" is given to the role Store Reviewers and Asha's Store Reviewers role is taken away
- **THEN** Asha's next request does not list "Stock ageing"

#### Scenario: An ended job no longer gives a report

- **WHEN** "Stock ageing" is given to the job Team Leader and Asha's Team Leader job ended yesterday
- **THEN** Asha's reports do not include "Stock ageing"

#### Scenario: Changing a bundle changes what people see

- **WHEN** "Team leader pack" is given directly to Asha and "Sales to date" is taken out of it
- **THEN** Asha's next request does not list "Sales to date"

### Requirement: A grant never widens which stores a person sees
A report with no store filter SHALL open for someone given it whose job reaches no store. A store-filtered report given to them SHALL NOT open and SHALL NOT count towards opening Dash, and the person lookup SHALL say why.

#### Scenario: Head office gets a company-wide report but not a store one

- **WHEN** Hari, whose job reaches no store, is given "Company summary", which has no store filter, and "Sales to date", which filters by store
- **THEN** Hari's reports are "Company summary" only, and the person lookup shows "Given, but their job reaches no store" for "Sales to date"

### Requirement: A report outside the list does not open
Opening a report outside the person's list SHALL be refused on the server, before any token or filter goes out, whatever the browser sends.

#### Scenario: Asking for a report not given is refused

- **WHEN** Asha asks to open "Stock ageing", which is not given to her, by its key
- **THEN** the request is refused and nothing is asked of MotherDuck

### Requirement: One access row gives one thing to one receiver
A Report Access row SHALL give exactly one report or one bundle to exactly one person, role or job. Any other mix, or a row repeating an existing one, SHALL be refused on save, by whatever route it is saved. A malformed row that reaches the reader SHALL give nothing.

#### Scenario: A row naming two receivers is refused

- **WHEN** a Report Access Manager saves a row giving "Stock ageing" to both Asha and the job Team Leader
- **THEN** the save is refused

#### Scenario: A repeated row is refused

- **WHEN** "Stock ageing" is already given directly to Asha and it is given to her again
- **THEN** the save is refused

### Requirement: A Report Access Manager manages access without being a System Manager
A Report Access Manager SHALL be able to write Report Bundle, Report Bundle Member and Report Access, and SHALL NOT be able to write Permission, Has Role, Data Scope or any other access Table. Anyone without that role or System Manager SHALL NOT be shown the page, and their reads of it and writes SHALL be refused on the server.

#### Scenario: The manager can give but can't change roles

- **WHEN** Meera, a Report Access Manager, gives "Stock ageing" to Asha and then tries to give Asha a role
- **THEN** the report is given and the role change is refused

#### Scenario: Someone else can't give a report

- **WHEN** Asha, who isn't a Report Access Manager, tries to give herself "Stock ageing" or to list who has what
- **THEN** both are refused

### Requirement: Each give and removal is kept with who and when
A give SHALL be recorded by its row's creator and date. A removal SHALL mark the row removed, which version history records with who and when, rather than delete it. A removed row SHALL give nothing, and the same thing MAY be given again as a new row. Taking a report out of a bundle SHALL work the same way.

#### Scenario: A removal is kept with who removed it

- **WHEN** Meera removes the row giving "Stock ageing" to Asha, and later gives it to her again
- **THEN** the first row stays, marked removed, with Meera and the time in its history, and Asha sees "Stock ageing" again through the new row

### Requirement: The page shows who has what, and why
The Report access page SHALL give a report or bundle to a person, role or job, list who has what with its kind, who gave it and a Remove, confirm a removal by naming it, and look up a person to show each report they see and why, including a given report that won't open for them. It SHALL also make bundles and put reports into them or take them out, since a Report Access Manager can't open the Admin pages.

#### Scenario: Looking up a person says why

- **WHEN** "Team leader pack" holds "Sales to date" and is given to the job Team Leader, Asha's current job is Team Leader, and Meera looks Asha up on the Report access page
- **THEN** the page lists "Sales to date" because "Job Team Leader, through Team leader pack"

### Requirement: A person with no reports can ask
Dash SHALL open only for someone with at least one report they can open, or who holds Report Access Manager or System Manager, failing closed. Anyone else opening it SHALL get the no-access page, which records an Access Request. The alert SHALL also go to Report Access Managers, linking to the Report access page, where they SHALL see the waiting list. The request SHALL clear once the person can open at least one report.

#### Scenario: A request clears when a report arrives

- **WHEN** Asha, with no report, has opened Dash, and Meera then gives her "Stock ageing"
- **THEN** Asha no longer shows as waiting for access, and Dash opens for her
