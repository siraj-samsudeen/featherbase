# Sign In And Accounts

## MODIFIED Requirements

### Requirement: See who is waiting for access

A System Manager SHALL see everyone who signed in but holds no role yet as the standard Person list, newest first, and open any of them to give them roles. Each person's full email address SHALL show. A person created without a name SHALL start with the part of their address before the @. The menu SHALL show how many are waiting, counting the same people the list shows.

#### Scenario: A new starter shows up

- **WHEN** someone from an allowed company domain signs in with Google for the first time
- **THEN** a System Manager sees them on the waiting list with their email address, and the menu count goes up by one

#### Scenario: Giving a role takes them off the list

- **WHEN** a System Manager opens a waiting person and gives them a role
- **THEN** that person no longer shows as waiting

#### Scenario: The waiting list works like any list

- **WHEN** a System Manager filters the waiting list by name or chooses which columns show
- **THEN** the list narrows and shows those columns the way every other list does, and only waiting people are ever listed

#### Scenario: Only System Managers see the list

- **WHEN** someone who is not a System Manager tries to open the waiting list
- **THEN** they are refused and see no count in their menu
