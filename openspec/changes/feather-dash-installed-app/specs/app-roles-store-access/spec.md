## ADDED Requirements

### Requirement: Scope comes from what a person is responsible for

An app SHALL be able to rely on Featherbase to work out which places a person is
responsible for, from the instance's own records of who holds which job and where.
Every app SHALL get the same answer for the same person, in the same form, worked out
afresh on every request. A person whose records cannot be matched to them alone SHALL
get no scope, never a partial one.

#### Scenario: Two apps agree on a manager's sections

- **WHEN** a Department Manager opens two different apps that both split their data by
  section
- **THEN** both apps cover exactly the same sections

#### Scenario: An ambiguous record gives no scope

- **WHEN** a person's employee record also belongs to someone else
- **THEN** every app refuses to show them any store until the records are corrected

### Requirement: Apps keep working when the roster changes shape

When the instance changes how it records who leads what, every person's scope SHALL be
the same before and after, and no app SHALL need a new version.

#### Scenario: A roster redesign leaves the report untouched

- **WHEN** the instance moves to a new way of recording positions and a Team Leader
  opens the report
- **THEN** they see the same sections as before the move

### Requirement: An app's roles follow people's jobs

An app SHALL declare the roles it needs. An admin SHALL decide, in a setting they can
edit, which jobs carry each of them, starting from suggestions the app makes. People
SHALL hold jobs, not app roles. Gaining or leaving a job SHALL change what they can use
in each app on their next request, and a later version of the app SHALL never undo the
admin's choices.

#### Scenario: A new Team Leader can open the report

- **WHEN** someone becomes a Team Leader and that job carries the app's reading role
- **THEN** their next request can open the app, with nobody having given them the app
  role by hand

#### Scenario: An upgrade keeps the admin's choice

- **WHEN** an admin has also let staff members open an app's report, which the app did
  not suggest, and the app is later upgraded
- **THEN** staff members can still open it
