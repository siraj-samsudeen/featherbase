# Trusted Runtime Packages

## ADDED Requirements

### Requirement: An upgrade needs only the new version

Installing or upgrading an app SHALL record its manifest, version and fingerprint, and a later upgrade SHALL start from that record, so an instance's deploy SHALL upgrade an installed app whose image ships only a newer version. Before any migration, the release SHALL still refuse an app the image does not ship, a rollback, a version with no migration from the installed one, and a step that needs the installed version's files, naming it.

#### Scenario: The image ships only the new version

- **WHEN** an instance with Tasker 3.0.1 installed deploys an image that ships only Tasker 3.0.2
- **THEN** the release passes, saying the deploy step upgrades Tasker from 3.0.1 to 3.0.2
- **AND** the deploy upgrades it, keeping every row

#### Scenario: Rolling back is refused

- **WHEN** an instance with an app at 99.0.0 deploys an image that ships only an older version of it
- **THEN** the release refuses before migrating, saying rolling an app back is refused

#### Scenario: An app removed from the image is refused

- **WHEN** an installed, enabled app is in no version in the image
- **THEN** the release refuses, saying to ship it or disable the app

#### Scenario: A step that needs the old files is named

- **WHEN** the instance's record of the installed version can't be read by this platform
- **THEN** the release refuses, naming the step that needs the installed version's files and how to ship it beside the new one
