# Report Access

## Purpose
Who may see which Dash report, and who may give one. A Report Access Manager gives reports across the company; a Team Report Manager gives only to the people who report to them, and only what they can open themselves.

## Requirements

### Requirement: A Team Report Manager gives only to their own team
A person holding Team Report Manager, and neither Report Access Manager nor System Manager, SHALL give a report or a bundle only to a person whose current Job Assignment reports to them, by their job assignment or their employee record. They SHALL NOT give to themselves, to a role or to a job.

#### Scenario: Giving a report she holds to her team

- **WHEN** Asha, a Team Report Manager who can open "Sales to date", gives it to Ravi, whose current job reports to her
- **THEN** Ravi's next request lists "Sales to date"

#### Scenario: Someone outside her team is refused

- **WHEN** Asha gives "Sales to date" to Meena, who reports to someone else
- **THEN** it is refused, and Meena is given nothing

#### Scenario: Giving to herself is refused

- **WHEN** Asha gives "Sales to date" to herself
- **THEN** it is refused

#### Scenario: A role or a job is refused

- **WHEN** Asha gives "Sales to date" to the job Team Leader
- **THEN** it is refused

### Requirement: A Team Report Manager gives only what they can open
A Team Report Manager SHALL give only a report Dash would open for them: given to them, with a Dash reader role, and opened by their own reach. A bundle SHALL be given only when every report in it is such a report.

#### Scenario: A report she can't open is refused

- **WHEN** Asha gives "Stock ageing", which she can't open, to Ravi
- **THEN** it is refused, and Ravi is given nothing

### Requirement: A Team Report Manager's writes come only through Dash
A Team Report Manager SHALL NOT make or change a bundle, and SHALL take away only a grant they gave to someone in their team. Their saves to the access Table SHALL be accepted only from Dash's own give and remove actions. A Report Access Manager SHALL keep giving and taking away as before.

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
