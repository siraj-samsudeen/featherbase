# Business Roles

## RENAMED Requirements

- FROM: `### Requirement: Report Analyst sees every store and only the reports given to them`
- TO: `### Requirement: Report Analyst sees their region's stores and only the reports given to them`

## MODIFIED Requirements

### Requirement: The starting roles as the owner reviewed them
The starting roles SHALL be as the owner reviewed them on 18-Nov-2026, with the owner's change of 28-Nov-2026: manager roles see their team's tickets; Head Office has no Dash; Owner Director reaches everything and is given by hand only; Supplier opens no Dash until the supplier area exists; Tester reads reports at the stores it is given; Regional Head reaches the stores of a region and is held by the HR titles Director, Managing Director and Chief Operating Officer, whose region is their job site's; Master Data Manager keeps the master tables. HR titles stay as HR has them: the Title Map only names the role a title holds. External people are given roles by hand.

#### Scenario: Adding the starting roles

- **WHEN** a System Manager clicks Add The Starting Roles on an instance with none
- **THEN** Owner Director, Tester and Supplier are given by hand only, no HR title maps to Owner Director, and Director, Managing Director and Chief Operating Officer map to Regional Head

#### Scenario: A director who is not an owner-director

- **WHEN** a Director's job is at the North head office and they hold no Owner Director, and business roles decide
- **THEN** they reach every open store in the North and none in the South, while an Owner Director at the same head office reaches both


### Requirement: Report Analyst sees their region's stores and only the reports given to them
The starting role Report Analyst SHALL be given by hand only and reach the region of the holder's job site, or of the store it is given at. It views reports in its area, never at reach All, so it gets only the reports given to its holder as a person, and Give Old Grants To Business Roles gives it nothing.

#### Scenario: A report analyst

- **WHEN** Rekha, whose job is at the North head office, is given Report Analyst by hand and Sales is given to her as a person
- **THEN** she opens Sales at every open store in the North and none in the South, and with no report given to her she gets none
