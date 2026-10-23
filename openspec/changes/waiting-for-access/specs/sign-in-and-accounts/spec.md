# Sign In and Accounts Delta

## ADDED Requirements

### Requirement: See who is waiting for access

A System Manager SHALL be able to see everyone who signed in but holds no role yet, newest first, with how they signed in and when, and open any of them to give them roles. Only an address's domain SHALL show in the list. The menu SHALL show how many are waiting.

#### Scenario: A new starter shows up

- **WHEN** someone from an allowed company domain signs in with Google for the first time
- **THEN** a System Manager sees them on the waiting list with their domain, the sign-in method and the time, and the menu count goes up by one

#### Scenario: Giving a role takes them off the list

- **WHEN** a System Manager opens a waiting person and gives them a role
- **THEN** that person no longer shows as waiting

#### Scenario: Only System Managers see the list

- **WHEN** someone who is not a System Manager tries to open the waiting list
- **THEN** they are refused and see no count in their menu

### Requirement: Tell System Managers about a new arrival

When a sign-in rule creates a new person, every enabled System Manager with an email address SHALL get one email saying who arrived, from which domain, how they signed in, and where to give them access. A failed email SHALL NOT stop that person signing in, and a day's alerts SHALL be capped.

#### Scenario: One email per arrival

- **WHEN** a new person is created by their first Google sign-in and later signs in again
- **THEN** each System Manager got exactly one email about them

#### Scenario: An invited person is not announced

- **WHEN** a person an administrator invited signs in for the first time
- **THEN** no alert is sent, because someone already knows they are coming

#### Scenario: Mail trouble does not lock anyone out

- **WHEN** the email cannot be sent as a new person signs in
- **THEN** they are signed in as normal
