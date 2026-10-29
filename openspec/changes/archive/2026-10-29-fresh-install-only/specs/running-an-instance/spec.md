## ADDED Requirements

### Requirement: A release refuses a database it did not install

A release SHALL refuse a database that has no record of Featherbase's changes
but already holds tables, before changing anything, and SHALL say to use a new
database.

#### Scenario: Pointing a release at someone else's database

- **WHEN** an operator releases onto a database that already holds tables but
  was never installed by Featherbase
- **THEN** the release stops, says to use a new database, and changes nothing

## MODIFIED Requirements

### Requirement: Rehearse a release on a copy

An operator SHALL be able to try every pending database change on a copy of
an instance, with nothing kept afterwards, and read what each change reported.
The rehearsal SHALL run each change as the release would.

#### Scenario: A copy of an instance last released long ago

- **WHEN** the operator rehearses on a copy of an instance released many
  versions ago
- **THEN** each pending change runs and reports as it would in the release
- **AND** the copy is left exactly as it was

#### Scenario: A copy the release would refuse

- **WHEN** the operator rehearses on a database the release would refuse
- **THEN** the rehearsal refuses with the same reason the release would give

### Requirement: A new instance starts in one step

A release onto an empty database SHALL build the platform from one starting
point, and SHALL list only a few steps.

#### Scenario: Installing a new instance

- **WHEN** an operator releases onto an empty database
- **THEN** it has every table and starting record the platform needs, and the
  release lists only a few steps

## REMOVED Requirements

### Requirement: A release refuses an instance that skipped versions

**Reason**: Every instance is a fresh install, so there is no older release to
upgrade with first. An installed instance gets every change it lacks, in
order; a database Featherbase did not install is refused (see "A release
refuses a database it did not install").
**Migration**: None.

### Requirement: An instance installed before the starting point is taken over

**Reason**: Dev and prod are wiped and installed fresh at go-live, so no
instance installed before the starting point will ever be released onto.
**Migration**: Wipe such an instance and install it fresh.
