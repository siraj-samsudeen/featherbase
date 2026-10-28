## ADDED Requirements

### Requirement: Scope comes from what a person is responsible for

An app SHALL be able to rely on Featherbase for the places a person is responsible
for. One app on the instance works them out from the instance's records of who holds
which job and where, and Featherbase asks it afresh on every request. Every app SHALL
get the same answer for the same person, in the same form. A person whose records
cannot be matched to them alone SHALL get no scope, never a partial one.

#### Scenario: Two apps agree on a manager's sections

- **WHEN** a Department Manager opens two different apps that both split their data by
  section
- **THEN** both apps cover exactly the same sections

#### Scenario: An ambiguous record gives no scope

- **WHEN** a person's employee record also belongs to someone else
- **THEN** every app refuses to show them any store until the records are corrected

### Requirement: A request outside a person's scope is refused whole

When a request names a place or a value outside the person's scope, Featherbase SHALL
refuse the whole request, record the refusal in the Access Log, and show nothing from
it.

#### Scenario: A Team Leader asks for another store

- **WHEN** a Team Leader of one section in store 12 asks an app for store 13's figures
- **THEN** the request is refused and nothing about store 13 is shown
- **AND** the refusal is recorded in the Access Log

#### Scenario: A repeated request after losing a store

- **WHEN** a manager repeats an earlier request after one of the stores it covered was
  taken from them
- **THEN** the repeat is refused, and the earlier answer is not shown again

#### Scenario: A narrower question gets a narrower answer

- **WHEN** a manager of two stores asks for one of them
- **THEN** the app answers for that store only

### Requirement: No scope means no access

A person whose scope cannot be worked out, or comes back empty, SHALL get no access to
anything scoped by place. This SHALL hold for an administrator too: an empty scope
never means everything.

#### Scenario: An administrator with no places

- **WHEN** an administrator who holds no job in any store opens a report scoped by
  place
- **THEN** the report refuses to show any store

#### Scenario: The scope cannot be worked out

- **WHEN** no app on the instance provides people's scope, or the one that does fails
  or gives a malformed answer
- **THEN** every request scoped by place is refused, and the refusal is recorded

### Requirement: A scope says which links are confirmed

A person's scope SHALL say, for each section it covers, whether the person's link to
it is confirmed or only assumed, so an app can show the difference.

#### Scenario: An assumed section is shown as assumed

- **WHEN** a manager's section is linked to them only by an assumption the roster has
  not confirmed
- **THEN** an app that shows their sections marks that one as assumed

### Requirement: The records that decide scope are protected

Records that decide people's scope SHALL be marked as such where they are defined, and
only a System Manager SHALL change them, whatever other permissions say.

#### Scenario: A staff member cannot widen their own scope

- **WHEN** a staff member who may edit other records tries to add themselves to a
  store's roster
- **THEN** the change is refused

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

#### Scenario: An upgrade does not bring back a removed suggestion

- **WHEN** an admin removed a job the app suggested, and the app is later upgraded
- **THEN** that job still does not carry the app's role

### Requirement: An app is never opened to everyone through a job setting

Featherbase SHALL refuse to let an app's role be carried by everyone, or by people
who are not signed in, and SHALL refuse to let the setting hand out an
administrator's rights. Only a System Manager SHALL change which jobs carry an app's
roles.

#### Scenario: Opening an app to everyone is refused

- **WHEN** an admin tries to let every signed-in person carry an app's reading role
- **THEN** the change is refused, and a release that finds such a setting refuses to
  start
