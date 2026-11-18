## MODIFIED Requirements

### Requirement: Hand changes correct or add a role
A System Manager SHALL be able to Correct a person's role (replacing the one from their title) or Also give one (adding it), each with an optional store it applies at, an optional end date and a reason. A hand change past its end date gives nothing. The business role Tables decide who reaches what, so nobody else may write them.

#### Scenario: Correcting a store manager's title

- **WHEN** Sundar's designation maps to Head Office, but he runs Lakeside, and a System Manager corrects his role to Store Manager
- **THEN** he holds Store Manager at Lakeside, corrected by hand

#### Scenario: A Report Access Manager alone

- **WHEN** someone holding Report Access Manager but not System Manager adds the starting roles or gives a role by hand
- **THEN** the change is refused

### Requirement: Who would gain or lose access
The comparison SHALL list only people whose Dash differs between the old rules and business roles: who would lose Dash, gain Dash, reach different stores or subcategories, or get different reports, with a count for each, and each person under every change that applies. Both pages judge a person by the same comparison, and each side by the code that decides when that side is live, so the comparison predicts exactly what the switch does. A report reaching someone only through a role such as Dash Reader is shown as needing a decision, not as a loss.

#### Scenario: A person whose access stays the same

- **WHEN** a store manager opens the same stores and gets the same reports in both
- **THEN** they are not listed

#### Scenario: A report given to Dash Reader

- **WHEN** a report reaches Ravi only because it is given to Dash Reader
- **THEN** it is listed as needing a decision for Ravi

#### Scenario: A prediction that comes true

- **WHEN** the comparison says Selvi would reach Lakeside and get Vendor Sales, and a System Manager switches Dash to business roles
- **THEN** Selvi's scope is Lakeside and Dash offers her Vendor Sales

## ADDED Requirements

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
Only when a System Manager asks SHALL Dash give each live grant to a job also to the business role its title maps to, and each grant to Dash Reader to every business role holding a Dash permission that is not given by hand only (to Dash All-Stores Reader, those reaching the whole company). Grants to a person stay as they are; old grants are never removed. Each addition, and each old grant with no matching role, is logged once, and running it again adds nothing.

#### Scenario: Running it twice

- **WHEN** a System Manager gives the old grants to business roles twice
- **THEN** the second run adds no grant and no log line

#### Scenario: A grant with no matching role

- **WHEN** a report is given to the role Report Access Manager
- **THEN** it is logged once as not converted and left as it was

### Requirement: The starting roles are added only on the button
The starting business roles and their Title Map rows SHALL be added only when Add The Starting Roles is clicked, and only those missing by name; a role or title already there is never changed. Each addition is logged.

#### Scenario: Clicking again after editing a role

- **WHEN** the owner edits Store Manager and Add The Starting Roles is clicked again
- **THEN** nothing is added and Store Manager is unchanged

### Requirement: The starting roles as the owner reviewed them
The starting roles SHALL be as the owner reviewed them on 18-Nov-2026: every manager role (Team Leader, Floor Manager, Department Manager, Store Manager, Cluster Manager, Category Head, Leadership) sees its team's tickets, while Staff, Buyer and Head Office raise their own; Head Office has no Dash permission; the master data role is named Master Data Manager; Vendor is named Supplier; a Tester role, given by hand at the stores it tests, reads their reports; a Regional Head reaches every store in the region of the site it is placed at, with no HR title mapped to it yet. Regions are the sites' own data. External people, such as consultants, get no role from a title and are given roles by hand.

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
The permission Edit Section names and subcategories SHALL mean editing a section's name and which subcategories sit under it, within the role's area. When business roles decide, a manager edits a section only where a role of theirs holding that permission comes from the very job whose store, floor, department or sections hold it; a role placed at another store gives no area at the job's own store, and a role on another axis (Floor against Department) gives none. Moving staff still follows the jobs. Under the old rules, the jobs alone decide.

#### Scenario: A store manager corrected to Staff

- **WHEN** Sundar runs Lakeside by his job, business roles decide, and his role is corrected by hand to Staff
- **THEN** he can no longer change Lakeside's sections

## REMOVED Requirements

### Requirement: The shadow model changes no one's access
**Reason**: business roles now decide Dash access once an instance is switched over (#1277).
**Migration**: until a System Manager adds the switch row, the old rules decide, as in shadow; the switch puts them back at any time.
