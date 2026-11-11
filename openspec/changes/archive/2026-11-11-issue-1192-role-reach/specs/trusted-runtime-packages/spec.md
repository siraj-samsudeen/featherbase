# Trusted Runtime Packages

## MODIFIED Requirements

### Requirement: An app knows the roles of the person it acts for
An app's actions and reads SHALL be told which roles the signed-in person holds, so an app can let a role take a
step. An app that provides people's scope SHALL be told, each time it works out a person's places, the roles that
person holds. Both SHALL be the roles Featherbase itself enforces for the person, read fresh, and an app SHALL learn
only that person's own roles, never another person's.

#### Scenario: Tickets offers a step to the holder of a role

```gherkin
Given a Data Quality Issue that Bala has marked fixed
And a person who holds the "Data Quality Verifier" role and is not involved in the ticket
When that person opens the ticket in Tickets
Then Tickets offers that person the verification
```

#### Scenario: A role taken away stops counting at once

- **WHEN** a person loses a role and then opens a page scoped by their places
- **THEN** the app working out their places is no longer told they hold it

### Requirement: A new table arrives with the access its version declares

A table an upgrade adds SHALL arrive with exactly the access its new version
declares for it, listed in the preview. Access to the tables the app already
had SHALL never widen through an upgrade for anyone who already holds a role.

#### Scenario: A new supplier table is readable by the clerks

- **WHEN** an upgrade adds a Supplier table that its version lets clerks read
- **THEN** the preview lists that access
- **AND** after the upgrade clerks can read suppliers

## ADDED Requirements

### Requirement: An upgrade can add a role new to the instance
An upgrade SHALL create each role its new version declares and its installed version did not, with the access the
version declares for it, reading only on a table the app already had, and the preview SHALL list it. Only a role new
to the instance qualifies, never a platform role, so the upgrade gives no one anything. When a role of that name
already exists, the upgrade SHALL be refused, naming it, and change nothing.

#### Scenario: A new reader role arrives with its access

- **WHEN** an upgrade's version declares a new Auditor role that may read the app's existing Tasks table
- **THEN** the preview lists the role and its access
- **AND** after the upgrade the role exists, held by nobody, and anyone later given it can read tasks

#### Scenario: A role of the same name already exists

- **WHEN** an upgrade's version declares a new Auditor role and the instance already has a role called Auditor
- **THEN** the preview and the upgrade are refused, naming the role
- **AND** the installed version and its access are unchanged

#### Scenario: A new role can't bring write access to an existing table

- **WHEN** an upgrade's version declares a new Auditor role that may edit the app's existing Tasks table
- **THEN** the preview is refused, and no Auditor role is created
