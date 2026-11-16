# View As

## ADDED Requirements

### Requirement: A tester sees what another person sees
A person holding a View as role SHALL be able to choose another person and then see every page as that person does: their reports, their stores and subcategories, and what their roles open. They do not need that person's password.

#### Scenario: The tester sees Meena's reports

- **WHEN** Priya, a View As Tester, views as Meena, a Team Leader at Lakeside
- **THEN** Priya sees Meena's reports for Meena's section at Lakeside, not her own

#### Scenario: Leaving returns the tester to their own view

- **WHEN** Priya stops viewing as Meena
- **THEN** she sees her own reports again

### Requirement: Nothing can be changed while viewing
While viewing as someone, the system SHALL refuse every change, whatever the page offers or the request asks, and say that the view is read-only.

#### Scenario: Giving a report is refused

- **WHEN** Priya, viewing as Meena, tries to give a report to someone
- **THEN** it is refused as read-only, and nothing is given

### Requirement: Finding a person to view
The tester SHALL be able to find a person by name, by employee code, or by a job and a store, and see each person's code, job and store beside their name. People they viewed lately and most often are offered without searching.

#### Scenario: Finding the team leader at a store

- **WHEN** Priya looks for "Team Leader Lakeside"
- **THEN** Meena is offered, with her code, her job and her store

### Requirement: Who cannot be viewed
Nobody SHALL be able to view as themselves, as a System Manager or Administrator, or as someone whose account is turned off.

#### Scenario: A System Manager cannot be viewed

- **WHEN** Priya chooses a System Manager to view as
- **THEN** it is refused, and she keeps her own view

### Requirement: Viewing ends on its own
Viewing as someone SHALL end after an hour, when the tester signs out, and when the tester no longer holds the role. It belongs to the one sign-in it was started in.

#### Scenario: Another sign-in is not viewing

- **WHEN** Priya views as Meena and also signs in on another device
- **THEN** the other device shows Priya her own view

### Requirement: Every view is on record
Each time a tester starts, switches or stops viewing as someone, the system SHALL record it under the tester's own name, naming the person viewed.

#### Scenario: The log names both people

- **WHEN** Priya views as Meena and then stops
- **THEN** the access log shows Priya started and ended viewing as Meena
