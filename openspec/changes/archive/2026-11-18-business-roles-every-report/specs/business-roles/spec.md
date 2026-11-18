## ADDED Requirements

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
