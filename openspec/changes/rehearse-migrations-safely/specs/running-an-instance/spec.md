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
