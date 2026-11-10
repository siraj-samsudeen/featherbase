## ADDED Requirements

### Requirement: A scheduled run waits for a server that can run it

When a server takes a run of an enabled scheduled job it has no handler for,
the system SHALL put the run back on the queue a minute later without using up
an attempt, for at most 30 minutes from the first time; after that the run SHALL
fail as an unknown job does.

#### Scenario: A deploy switches on a new scheduled job

- **WHEN** the previous deployment, which has no handler for the job, takes its
  first run
- **THEN** the run goes back on the queue a minute later with no attempt used,
  says it is waiting for a server with the handler, and the new deployment runs it

#### Scenario: The handler never comes

- **WHEN** a run has been handed back for more than 30 minutes
- **THEN** it fails as an unknown job, and the System Managers are told

#### Scenario: A job that is not scheduled

- **WHEN** a server takes a run it has no handler for, and the job has no enabled
  scheduled job
- **THEN** the run fails at once, as before
