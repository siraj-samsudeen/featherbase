## MODIFIED Requirements

### Requirement: A release brings the database up to date

A release SHALL apply every database change that has not been applied yet,
and SHALL leave an instance that is already up to date as it was.

#### Scenario: Releasing an older instance keeps its data

- **WHEN** an operator releases a new version onto an instance last released
  some versions ago
- **THEN** its rows and permissions are all still there afterwards
- **AND** the instance is on the new version

#### Scenario: Releasing twice

- **WHEN** an operator releases again with nothing new to apply
- **THEN** nothing is applied a second time

### Requirement: A release refuses an instance that skipped versions

A release SHALL refuse an instance it cannot bring up to date, before changing
anything, and SHALL say which earlier release can upgrade it first.

#### Scenario: An instance with a gap in its history

- **WHEN** an operator releases onto an instance that is missing one of its
  earlier database changes
- **THEN** the release stops, names the missing change and the release to
  upgrade with first, and changes nothing

## ADDED Requirements

### Requirement: A new instance starts in one step

A release onto an empty database SHALL build the platform from one starting
point, the same as replaying its whole history would, without reporting that
history.

#### Scenario: Installing a new instance

- **WHEN** an operator releases onto an empty database
- **THEN** it has the same tables and starting records as an instance built
  change by change, and the release lists only a few steps

### Requirement: An instance installed before the starting point is taken over

A release onto an instance that has every change the starting point replaced
SHALL record the starting point as done without running it, and SHALL leave
the instance's tables and rows as they were.

#### Scenario: Releasing onto the live trial

- **WHEN** an operator releases onto an instance that was fully up to date
  before the starting point existed
- **THEN** its people, settings and records are unchanged, and later releases
  carry on from the starting point

## REMOVED Requirements

### Requirement: Each one-off fix runs once

**Reason**: One-off fixes are gone; database changes are the one way to change
an instance, and they already run once, in order, each in one step.
**Migration**: The only fix is part of the starting point; its record is
removed from instances that have it.

### Requirement: The person-record changes stand or fall together

**Reason**: Those changes are part of the starting point, so no release
applies them one by one any more.
**Migration**: None; every instance either has them or starts from the
starting point.
