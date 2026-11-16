## MODIFIED Requirements

### Requirement: A new access rule needs a new, reviewed version

An app SHALL only gain a new access rule — such as who may read or act on
one of its tables — by shipping a new version; Featherbase SHALL NOT let an
already-installed version quietly pick up a rule it didn't originally
declare. Deploying a version is its review: an upgrade SHALL apply the new or
wider access that version declares for the roles it declares, and SHALL
refuse any for everyone, for signed-out visitors, for a platform role or for
a role the app doesn't declare.

#### Normative details for the whole requirement

A new version MAY withdraw a rule its predecessor
declared; applying it SHALL remove only the grant that app created, and
record the withdrawal in the activity log. Every rule an upgrade adds SHALL be
listed in its preview and the deploy's log, and recorded in the activity log.
This holds while Featherbase serves one client with one System Manager, and is
to be revisited before a second.

#### Scenario: An old version can't gain a new rule for free

- **WHEN** an app adds an access rule that its currently installed version
  never declared
- **THEN** using it requires installing that new version, previewed and
  turned on like any other upgrade

#### Scenario: A new version lets an existing role edit

- **WHEN** an upgrade's version lets the app's Reviewers role, which could
  only read tasks, also edit them
- **THEN** the preview lists that access, and after the upgrade reviewers can
  edit tasks
- **AND** the activity log records the access added

#### Scenario: A new version can't open a table to everyone

- **WHEN** an upgrade's version lets every signed-in person edit tasks
- **THEN** the preview is refused, and the installed version is unchanged

#### Scenario: A new version can withdraw a rule

- **WHEN** an upgrade's new version no longer declares an access rule its
  installed version declared
- **THEN** the preview lists the rule as withdrawn
- **AND** applying the upgrade removes the grant the app created, and no other
- **AND** the activity log records the withdrawal

### Requirement: A new table arrives with the access its version declares

A table an upgrade adds SHALL arrive with exactly the access its new version
declares for it, listed in the preview.

#### Scenario: A new supplier table is readable by the clerks

- **WHEN** an upgrade adds a Supplier table that its version lets clerks read
- **THEN** the preview lists that access
- **AND** after the upgrade clerks can read suppliers

## REMOVED Requirements

### Requirement: An upgrade can add a role new to the instance

**Reason**: It limited a new role to reading Tables the app already had (#1192). Since #1169 an upgrade may bring any access its version declares for its own roles.

**Migration**: Replaced by "An upgrade can create a role the instance doesn't have", which keeps every other promise.

## ADDED Requirements

### Requirement: An upgrade can create a role the instance doesn't have
An upgrade SHALL create each role its new version declares and its installed version did not, with the access the
version declares for it, and the preview SHALL list it. Only a role new to the instance qualifies, never a platform
role, so the new role starts with nobody holding it. When a role of that name already exists, the upgrade SHALL be
refused, naming it, and change nothing.

#### Scenario: A new reader role arrives with its access

- **WHEN** an upgrade's version declares a new Auditor role that may read the app's existing Tasks table
- **THEN** the preview lists the role and its access
- **AND** after the upgrade the role exists, held by nobody, and anyone later given it can read tasks

#### Scenario: A role of the same name already exists

- **WHEN** an upgrade's version declares a new Auditor role and the instance already has a role called Auditor
- **THEN** the preview and the upgrade are refused, naming the role
- **AND** the installed version and its access are unchanged

#### Scenario: A new role can bring write access to an existing table

- **WHEN** an upgrade's version declares a new Auditor role that may edit the app's existing Tasks table
- **THEN** after the upgrade the Auditor role exists and anyone given it can edit tasks
