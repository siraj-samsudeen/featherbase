# Report Access

## ADDED Requirements

### Requirement: A Team Report Manager gives reports to their own team only
A person holding the role Team Report Manager, and neither Report Access Manager nor System Manager, SHALL be able to give a report, or a bundle, only to a person whose current Job Assignment reports to them, by their job assignment or their employee record. They SHALL give only a report they can open themselves, or a bundle whose every report they can open. They SHALL NOT give to themselves, to a role or to a job, and SHALL NOT make or change a bundle. They SHALL take away only a grant they gave to someone in their team. A Report Access Manager SHALL keep giving and taking away as before.

#### Scenario: Giving a report she holds to her team

- **WHEN** Asha, a Team Report Manager who can open "Sales to date", gives it to Ravi, whose current job reports to her
- **THEN** Ravi's next request lists "Sales to date"

#### Scenario: Someone outside her team is refused

- **WHEN** Asha gives "Sales to date" to Meena, who reports to someone else
- **THEN** it is refused, and Meena is given nothing

#### Scenario: A report she can't open is refused

- **WHEN** Asha gives "Stock ageing", which she can't open, to Ravi
- **THEN** it is refused, and Ravi is given nothing

#### Scenario: Giving to herself is refused

- **WHEN** Asha gives "Sales to date" to herself
- **THEN** it is refused

#### Scenario: A role or a job is refused

- **WHEN** Asha gives "Sales to date" to the job Team Leader
- **THEN** it is refused

#### Scenario: Writing the row directly is refused

- **WHEN** Asha saves a row giving "Stock ageing" to Meena straight into the access Table, not through the page
- **THEN** it is refused

#### Scenario: She takes away only what she gave her team

- **WHEN** Asha removes a grant a Report Access Manager gave Ravi
- **THEN** it is refused, and Ravi keeps the report

### Requirement: A Team Report Manager sees only their team on the Report access page
For a Team Report Manager the Report access page SHALL list only the people in their team to give to and look up, only grants made to those people, only the reports and bundles they may give, and no bundle tools or waiting list. It SHALL say that they manage access for their team.

#### Scenario: The page shows her team only

- **WHEN** Asha opens Report access
- **THEN** she sees Ravi but not Meena, Ravi's grants but not Meena's, and no Bundles or Waiting sections
