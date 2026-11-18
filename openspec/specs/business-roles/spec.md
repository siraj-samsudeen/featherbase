# Business Roles

## Purpose
What the business calls each position, the apps and permissions it brings, and where it applies, worked out for every person (#1218). One switch decides whether these roles or the old rules decide Dash access (#1277); the comparison shows who would gain or lose access either way.

## Requirements

### Requirement: Business roles are rows an admin edits
A business role SHALL be a named row with its permissions, each permission an app and level, a verb, a thing and a reach (Own, Team, Area or All). Each permission reads as one sentence. How far the role reaches (their section, floor, department, store or cluster, their merchandise, the whole company, or a place it is given at) is set on the role itself, so renaming a role changes nobody's area.

#### Scenario: A permission read as a sentence

- **WHEN** the admin opens the Store Manager role
- **THEN** it reads "Store Managers can Edit Sections in their Area", marked Area

### Requirement: Titles map to business roles
Each HR title in use SHALL map to at most one business role. A person's role comes from their designation's mapping, else from their job's. A title with no mapping is listed as not mapped yet, with how many people hold it, and is never guessed.

#### Scenario: A title nobody has mapped

- **WHEN** three people hold the designation "Operations Executive" and no mapping names it
- **THEN** the Title Map lists it first as not mapped yet, held by 3 people

### Requirement: A person's roles come with their area and source
A person's business roles SHALL be worked out from their HR title, their merchandise assignments, a cluster that names them as its head, and hand changes. Each role shows the area it applies to and where it came from. A role reaching the whole company reaches it from any source; any other role gets an area only where its source has that kind of place, and otherwise shows no area, saying why.

#### Scenario: A buyer's area

- **WHEN** Bina is Category head of Sarees in the East by her merchandise assignment
- **THEN** she holds Category Head, with the area Sarees · East, from her merchandise assignment

### Requirement: Hand changes correct or add a role
A System Manager SHALL be able to Correct a person's role (replacing the one from their title) or Also give one (adding it), each with an optional store it applies at, an optional end date and a reason. A hand change past its end date gives nothing. The business role Tables decide who reaches what, so nobody else may write them.

#### Scenario: Correcting a store manager's title

- **WHEN** Sundar's designation maps to Head Office, but he runs Lakeside, and a System Manager corrects his role to Store Manager
- **THEN** he holds Store Manager at Lakeside, corrected by hand

#### Scenario: A Report Access Manager alone

- **WHEN** someone holding Report Access Manager but not System Manager adds the starting roles or gives a role by hand
- **THEN** the change is refused

### Requirement: Explain a person
For one person, the page SHALL show each business role with its area and source, the apps and levels they would open, and the reports they would get, each with why.

#### Scenario: Why a store manager gets a report

- **WHEN** the manager explains Selvi, Store Manager of Lakeside, and Vendor Sales is given to Store Manager
- **THEN** Vendor Sales is listed, given to Store Manager, for Lakeside

### Requirement: Who would gain or lose access
The comparison SHALL list only people whose Dash differs between the old rules and business roles (losing or gaining Dash, other stores or subcategories, other reports), with a count for each and each person under every change that applies. Each side is worked out by the code that decides when that side is live, so it predicts exactly what the switch does. A report reaching someone only through a role such as Dash Reader is shown as needing a decision.

#### Scenario: A person whose access stays the same

- **WHEN** a store manager opens the same stores and gets the same reports in both
- **THEN** they are not listed

#### Scenario: A report given to Dash Reader

- **WHEN** a report reaches Ravi only because it is given to Dash Reader
- **THEN** it is listed as needing a decision for Ravi

#### Scenario: A prediction that comes true

- **WHEN** the comparison says Selvi would reach Lakeside and get Vendor Sales, and a System Manager switches Dash to business roles
- **THEN** Selvi's scope is Lakeside and Dash offers her Vendor Sales

### Requirement: One switch decides which rules apply
Dash access SHALL be decided by business roles or by the old rules (jobs, Dash Reader and Dash All-Stores Reader, and grants to jobs and roles), as the Dash access source row says. No row, or any row not saying business roles, means the old rules; no step adds the row by itself. Only a System Manager changes it, and the scope provider and every read take it on the next request, with no deploy.

#### Scenario: A new release changes nothing

- **WHEN** Dash 0.13.30 is deployed and nobody adds a Dash access source row
- **THEN** every person's Dash opening, stores and reports are those of the old rules

#### Scenario: Putting the old rules back

- **WHEN** business roles decide and a System Manager sets the Dash access source to Old rules
- **THEN** on the next request every person's Dash opening, stores and reports are those of the old rules

### Requirement: Business roles decide what is behind Dash's door
When business roles decide, Dash SHALL open for someone the platform lets in (holding one of Dash's roles, or System Manager) who holds a business role with a Dash permission or a role that manages access, or is offered a report. Their places are the areas of their business roles holding a Dash permission. A report reaches them when given to them or to a business role they hold.

#### Scenario: A store manager

- **WHEN** Selvi holds Dash Reader, her HR title maps to Store Manager at Lakeside, and Store Totals is given to Store Manager
- **THEN** Dash opens for her, she reaches Lakeside, and she is offered Store Totals

#### Scenario: Staff holding Dash Reader

- **WHEN** Siva is Staff, whose business role holds no Dash permission, and holds Dash Reader
- **THEN** Dash does not open for him

#### Scenario: Grants to jobs and Dash roles

- **WHEN** Vendor Sales is given only to the job Store Manager and to Dash Reader
- **THEN** it reaches nobody while business roles decide

### Requirement: The comparison names who needs a Dash role
The comparison SHALL list, as needing a Dash role, each person whose business roles would open Dash but who holds none of Dash's roles, so the platform keeps them out.

#### Scenario: A buyer with no Dash role

- **WHEN** Bina's merchandise assignment makes her a Buyer, and she holds no Dash role
- **THEN** she is listed as needing a Dash role

### Requirement: Reports are given to business roles
A report or a bundle SHALL be givable to one business role, as to a person, a role or a job; a grant names exactly one receiver.

#### Scenario: Giving Vendor Sales to Store Manager

- **WHEN** a Report Access Manager gives Vendor Sales to the business role Store Manager
- **THEN** one grant names Vendor Sales and Store Manager, and every Store Manager gets it for their own area

### Requirement: Old grants are given to business roles only when asked
Only when a System Manager asks SHALL Dash give each live grant to Dash Reader also to the manager roles that open Dash and are not given by hand only. Every other old grant (to a job, to Dash All-Stores Reader, to any other role) stays where it is and is added on request. Grants to a person stay as they are; old grants are never removed. Each addition, and each grant not carried over, is logged once; running it again adds nothing.

#### Scenario: Running it twice

- **WHEN** a System Manager gives the old grants to business roles twice
- **THEN** the second run adds no grant and no log line

#### Scenario: Store Reports for All Dash Users

- **WHEN** the bundle Store Reports for All Dash Users is given to Dash Reader and a System Manager gives the old grants to business roles
- **THEN** Team Leader, Floor Manager, Department Manager, Store Manager, Cluster Manager, Regional Head, Buyer, Category Head and Division Head get it, and no visual merchandising, Staff, Head Office or hand-only role does

#### Scenario: A grant to a job

- **WHEN** Vendor Sales is given to the job Store Manager and a System Manager gives the old grants to business roles
- **THEN** it is not given to any business role, is logged as not carried over, and Who Would Gain Or Lose Access lists it as not carried over, add on request, with Selvi among those who would lose it

#### Scenario: A grant with no matching role

- **WHEN** a report is given to the role Report Access Manager
- **THEN** it is logged once as not converted and left as it was

### Requirement: The starting roles are added only on the button
The starting business roles and their Title Map rows SHALL be added only when Add The Starting Roles is clicked, and only those missing by name; a role or title already there is never changed. Each addition is logged.

#### Scenario: Clicking again after editing a role

- **WHEN** the owner edits Store Manager and Add The Starting Roles is clicked again
- **THEN** nothing is added and Store Manager is unchanged

### Requirement: The starting roles as the owner reviewed them
The starting roles SHALL be as the owner reviewed them on 18-Nov-2026: manager roles see their team's tickets; Head Office has no Dash; Owner Director reaches everything and is given by hand only; Supplier opens no Dash until the supplier area exists; Tester reads reports at the stores it is given; Regional Head reaches the stores of a region, with no title mapped yet; Master Data Manager keeps the master tables. External people are given roles by hand.

#### Scenario: Adding the starting roles

- **WHEN** a System Manager clicks Add The Starting Roles on an instance with none
- **THEN** Owner Director, Tester and Supplier are given by hand only, and no HR title maps to Owner Director or Regional Head

### Requirement: Division Head and the visual merchandising roles
The starting roles SHALL include Division Head, with a Category Head's permissions over the division their merchandise assignment names in its region, and two visual merchandising roles: Visual Merchandising Manager reaching the open stores of their region, and Visual Merchandiser their own store, each with nothing to give or edit. Merchandiser, the buying side, is not visual merchandising.

#### Scenario: A division head

- **WHEN** Devika's merchandise assignment as Division head names the division Home in the East, and business roles decide
- **THEN** she reaches every merchandise subcategory of Home at every open store in the East, and none in the West

#### Scenario: Visual merchandising

- **WHEN** Vimala's HR title is Manager - visual merchandising at a store in the East, and Vasu's is Visual merchandiser at Hillview
- **THEN** Vimala reaches every open store in the East, Vasu reaches Hillview only, and neither may give reports or edit sections

#### Scenario: New starting roles on an instance that has the others

- **WHEN** Add The Starting Roles is clicked on an instance whose starting roles were added before Division Head and the visual merchandising roles existed, and whose Category Head the owner has edited
- **THEN** only those three roles and their titles are added, and Category Head is unchanged

### Requirement: Only an open store gives store reach
A role placed at a site SHALL reach a store there only when the site is an open store: not Planned or Closed, of site kind Store where classified, else marked as a store. The Site is read alike on every path. Someone given a business role by hand is never shown as having left.

#### Scenario: A head office site

- **WHEN** a Store Manager role is placed at a head office site with a selling plant
- **THEN** it reaches no store there

#### Scenario: Head office staff

- **WHEN** Omar's HR title maps to Head Office and business roles decide
- **THEN** Dash does not open for him until a role with Dash is given to him by hand, or a report is given to him

#### Scenario: A consultant

- **WHEN** a System Manager also gives Store Manager at Lakeside to a consultant on no staff list
- **THEN** Explain shows Store Manager at Lakeside, also given by hand, and with a Dash role the consultant reaches Lakeside

#### Scenario: A regional head

- **WHEN** Regional Head is given by hand to someone whose job is at a store in the East
- **THEN** they reach every store whose site is in the East, and no other

### Requirement: Editing sections follows business roles when they decide
The permission Edit Section names and subcategories SHALL mean editing a section's name and which subcategories sit under it. When business roles decide, a manager edits a section only within the area a role of theirs with that permission resolves to from the very job whose area holds it, never wider than the job's area nor across axes, and only at an open store. Moving staff still follows the jobs.

#### Scenario: A store manager corrected to Staff

- **WHEN** Sundar runs Lakeside by his job, business roles decide, and his role is corrected by hand to Staff
- **THEN** he can no longer change Lakeside's sections

### Requirement: The comparison reads the company once
The comparison SHALL read each Table once for the whole company, and every person's platform roles in one read, never once per person, and SHALL give each person exactly what Explain gives them.

#### Scenario: The whole company at once

- **WHEN** a manager opens the comparison on an instance with 9,200 people
- **THEN** it answers well within the platform's time, and each person listed is listed exactly as Explain shows them

### Requirement: A role viewing every report gets every report
A business role holding the Dash permission View Reports at reach All SHALL be offered every report the instance has, at every store, wherever the role itself reaches; Owner Director holds it, and so does any role an admin gives it later. Explain and the comparison SHALL say so in plain words: "Every report, through Owner Director". View Reports at any narrower reach, or any other app, verb or thing at reach All, SHALL give only the reports given.

#### Scenario: An Owner Director named by hand

- **WHEN** Omana is given Owner Director by hand and no report is given to her
- **THEN** she is offered every report at every store, and Explain says each one reaches her as "Every report, through Owner Director"

#### Scenario: A role an admin adds later

- **WHEN** an admin gives a new role, Auditor, reaching one store, View Reports at reach All
- **THEN** its holders are offered every report at every store

#### Scenario: A narrower reach

- **WHEN** a role holds View Reports at reach Area
- **THEN** its holders get only the reports given to them or to their roles
