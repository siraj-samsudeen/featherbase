## MODIFIED Requirements

### Requirement: An account is linked to the person who uses it

When exactly one person has an account's email, the sync SHALL link the account
to that person. Every other account a person uses SHALL get one ticket asking
the MotherDuck reviewer to link it, naming the people whose names it reads as;
the ticket SHALL close itself once the account is linked. An account a program
uses gets no ticket. Every such ticket SHALL sit under one umbrella ticket, which
the sync resolves when none of its sub-tickets is open and reopens, never
duplicates, when it raises a new one (#1397).

#### Scenario: Linked by email

- **WHEN** an account's email is the email of exactly one person
- **THEN** the account is linked to that person, and no ticket is raised

#### Scenario: Linked by hand

- **WHEN** an account has no email that names one person
- **THEN** one ticket asks the reviewer to link it, and once someone sets its
  person, the next sync closes the ticket

#### Scenario: One umbrella across runs

- **WHEN** the sync raises tickets on two runs, and every ticket was closed between them
- **THEN** all of them sit under the same umbrella ticket, which was resolved after the first run's tickets closed and reopened by the second run
