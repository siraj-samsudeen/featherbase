## ADDED Requirements

### Requirement: Rehearse a release on a copy

An operator SHALL be able to try every pending database change on a copy of
an instance, with nothing kept afterwards, and read what each change reported.
The rehearsal SHALL run each change as the release would, whatever version the
copy was taken at.

#### Scenario: A copy of an instance last released long ago

- **WHEN** the operator rehearses on a copy of an instance released many
  versions ago, whose changes the release still knows how to bring up to date
- **THEN** each pending change runs and reports as it would in the release
- **AND** the copy is left exactly as it was

#### Scenario: A copy the release would refuse

- **WHEN** the operator rehearses on a copy too old for this release to upgrade
- **THEN** the rehearsal refuses with the same reason the release would give

### Requirement: A rehearsal does not hold up a live instance

A rehearsal SHALL refuse a database that others are connected to unless the
operator says they mean it, and SHALL give up within seconds rather than wait
behind someone else's work.

#### Scenario: Pointing the rehearsal at the live instance by mistake

- **WHEN** the operator rehearses against a database the running server is
  connected to
- **THEN** the rehearsal refuses before it changes anything, and says it looks
  like a live instance rather than a copy

#### Scenario: A change that would have to wait

- **WHEN** someone else is using a table a pending change needs to alter
- **THEN** the rehearsal stops within a few seconds and says it could not get
  the table, instead of waiting
