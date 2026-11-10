# Trusted Runtime Packages

## MODIFIED Requirements

### Requirement: A new access rule needs a new, reviewed version

An app SHALL only gain a new access rule — such as who may read or act on
one of its tables — by shipping a new, reviewed version; Featherbase SHALL
NOT let an already-installed version quietly pick up a rule it didn't
originally declare.

#### Normative details for the whole requirement

A new version MAY withdraw a rule its predecessor
declared; applying it SHALL remove only the grant that app created, and
record the withdrawal in the activity log.

#### Scenario: An old version can't gain a new rule for free

- **WHEN** an app adds an access rule that its currently installed version
  never declared
- **THEN** using it requires installing that reviewed new version, previewed
  and turned on like any other upgrade

#### Scenario: A new version can withdraw a rule

- **WHEN** an upgrade's new version no longer declares an access rule its
  installed version declared
- **THEN** the preview lists the rule as withdrawn
- **AND** applying the upgrade removes the grant the app created, and no other
- **AND** the activity log records the withdrawal

## ADDED Requirements

### Requirement: An upgrade needs only the new version

An upgrade SHALL need only the new version's files. What the installed version declared is
remembered when it is installed, so the server does not have to keep its files to move on from it.

#### Scenario: An app upgrades once its old files are gone

```gherkin
Given the user installed version 1 of an app and added a row to it
And the server now holds only version 2 of that app
When the user previews and applies the upgrade to version 2
Then the app is on version 2 and the row is still there
```
