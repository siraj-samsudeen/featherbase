# Business Roles

## Purpose
What the business calls each position, the apps and permissions it brings, and where it applies, worked out for every person beside today's Dash access (#1218, option A). In shadow, it decides nobody's access: it explains people and shows who would gain or lose access before a later switch-over.

## Requirements

### Requirement: Business roles are rows an admin edits
A business role SHALL be a named row with its permissions, each permission an app and level, a verb, a thing and a reach (Own, Team, Area or All). Each permission reads as one sentence.

#### Scenario: A permission read as a sentence

- **WHEN** the admin opens the Store Manager role
- **THEN** it reads "Store Managers can Edit Sections in their Area", marked Area

### Requirement: Titles map to business roles
Each HR title in use SHALL map to at most one business role. A person's role comes from their designation's mapping, else from their job's. A title with no mapping is listed as not mapped yet, with how many people hold it, and is never guessed.

#### Scenario: A title nobody has mapped

- **WHEN** three people hold the designation "Operations Executive" and no mapping names it
- **THEN** the Title Map lists it first as not mapped yet, held by 3 people

### Requirement: A person's roles come with their area and source
A person's business roles SHALL be worked out from their HR title, their merchandise assignments, a cluster that names them as its head, and hand changes. Each role shows the area it applies to and where it came from. Head Office and Leadership reach the whole company.

#### Scenario: A buyer's area

- **WHEN** Bina is Category head of Sarees in the East by her merchandise assignment
- **THEN** she holds Category Head, with the area Sarees · East, from her merchandise assignment

### Requirement: Hand changes correct or add a role
A Report Access Manager or System Manager SHALL be able to Correct a person's role (replacing the one from their title) or Also give one (adding it), each with an optional store it applies at, an optional end date and a reason. A hand change past its end date gives nothing.

#### Scenario: Correcting a store manager's title

- **WHEN** Sundar's designation maps to Head Office, but he runs Lakeside, and the manager corrects his role to Store Manager
- **THEN** he holds Store Manager at Lakeside, corrected by hand

### Requirement: Explain a person
For one person, the page SHALL show each business role with its area and source, the apps and levels they would open, and the reports they would get, each with why.

#### Scenario: Why a store manager gets a report

- **WHEN** the manager explains Selvi, Store Manager of Lakeside, and Vendor Sales is given to Store Manager
- **THEN** Vendor Sales is listed, given to Store Manager, for Lakeside

### Requirement: Who would gain or lose access
The comparison SHALL list only people whose Dash would change under the new model: who would lose Dash, gain Dash, reach different stores or subcategories, or get different reports, with a count for each, and each person under every change that applies. Both pages judge a person by the same comparison. A report reaching someone only through a role such as Dash Reader is shown as needing a decision, not as a loss.

#### Scenario: A person whose access stays the same

- **WHEN** a store manager opens the same stores and gets the same reports in both
- **THEN** they are not listed

#### Scenario: A report given to Dash Reader

- **WHEN** a report reaches Ravi only because it is given to Dash Reader
- **THEN** it is listed as needing a decision for Ravi

### Requirement: The shadow model changes no one's access
While the new model runs in shadow, what opens Dash, which stores a person reaches and which reports they get SHALL stay decided by today's roles, jobs and grants.

#### Scenario: A hand change in shadow

- **WHEN** the manager also gives Ravi the Store Manager role
- **THEN** Ravi's Dash shows the same reports and stores as before
