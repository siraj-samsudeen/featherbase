## ADDED Requirements

### Requirement: Search lists each human once

A Table may name the column through which each of its rows is a person's record
(`person_column`, a link to Person). Search SHALL fold a hit on such a row into
that Person, so one human never appears twice. A row whose person the viewer may
not read, or that names no one, stays a hit of its own Table (#1345).

#### Scenario: A staff member found by name

- **WHEN** an admin searches a name held by one staff member who has both an Employee row and a Person
- **THEN** one result shows: the Person

#### Scenario: A staff member found by employee code

- **WHEN** Employee lists `employee_code` among its searched columns and an admin types that code
- **THEN** the result is the staff member's Person, not their Employee row

### Requirement: A person in search reads who they are

Each person in search SHALL read their name and, under it, muted
`employee code · role · place`. The code is the platform's own, shown only to a
viewer who may read Person. Role, place and standing come from an app that
describes people; without one, or when it fails or is late, the line reads
code · email, and never an error (#1345).

#### Scenario: Three people with one name

- **WHEN** an admin searches a name three staff members share
- **THEN** each result reads its own code, role and place, and no two results read the same

#### Scenario: Someone who has left

- **WHEN** the person found has left
- **THEN** their result reads "Former Staff", the day they left where the viewer may read it, and their code

#### Scenario: Someone with no employee code

- **WHEN** the person found has no employee code and no role or place
- **THEN** their result reads their name and email

### Requirement: Search results are links

Every record in search results SHALL be a link to it, so it can be opened in a
new tab or window; a plain click opens it in place and closes the search
(audit F16/F17/F19, #1345).

#### Scenario: Opening a result in a new tab

- **WHEN** a user middle-clicks a person in search results
- **THEN** the person's record opens in a new tab and the search stays open
