## ADDED Requirements

### Requirement: A conflict notice outlives a mail outage

When a refresh has committed new conflicts but its notice cannot be queued, the system SHALL keep the notice in its own background job, retried every 15 minutes for a day, without running the copy again. After a day of refusals the notice job SHALL fail like any other job.

#### Scenario: The mail queue refuses the notice

- **WHEN** the hourly Plants refresh records a new conflict and the conflict notice cannot be queued
- **THEN** the refresh still succeeds, its result says the notice will be tried again, and a conflict notice job waits for its next try

#### Scenario: The mail queue recovers

- **WHEN** the waiting conflict notice job runs after the mail queue accepts mail again
- **THEN** the System Managers receive the notice naming Plants and its new conflict count, and no new import batch is created

#### Scenario: The outage lasts a day

- **WHEN** the conflict notice job is still refused on its last try
- **THEN** the job fails with a message saying the notice could not be queued for a day
