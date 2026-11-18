## ADDED Requirements

### Requirement: New joiners reach the roster

When the roster names how joiners are built, each roster run SHALL add a row
for every record the HR feed shows plainly current that no roster row holds,
in any status, and, where the settings name a job Table, that person's primary
job. Nobody the leaver rule calls left, and nobody off the payroll who is not a
recent joiner, SHALL be added. Each addition SHALL show in Activity as the
roster link's, and the same run SHALL link them.

#### Scenario: A new joiner is added with their job

- **WHEN** the HR feed shows someone who joined last week, active, at a store,
  and no roster row holds their record
- **THEN** the roster gains their row, their primary job at that store's site,
  and, in the same run, their account and sign-in link

#### Scenario: Someone the feed shows as left is never added

- **WHEN** a record with no roster row has an exit date that has passed, is
  inactive, or is off the payroll since long ago
- **THEN** no row is added for it

#### Scenario: A joiner with no store site

- **WHEN** a joiner's store maps to no site
- **THEN** their row is added without a job, and the run says the job was held

#### Scenario: Too many joiners at once

- **WHEN** a run would add more than one in twenty of the current rows, and
  more than ten, or the HR feed is stale
- **THEN** it adds none and is reported as refused, and still links
