# Background and Scheduled Jobs

## Purpose

Some work runs in the background instead of making the user wait, and some
work runs on its own on a repeating schedule. An admin can see how each run
went and get failed work to run again.

## Requirements

### Requirement: Long work runs in the background

Work started as a background job SHALL run without holding up the request
that started it, and the user can watch it progress and see when it's done.

#### Scenario: Watch a job progress

- **WHEN** a user starts a job that reports its progress as it runs
- **THEN** they see it climb toward done without the page being stuck
  waiting for it

### Requirement: See every job's status in one place

An admin SHALL see every background job's status, how many attempts it's
had, and any error, in one list.

#### Scenario: Check what's running

- **WHEN** an admin opens the background jobs list
- **THEN** each job shows whether it's queued, running, done or failed, its
  attempt count, and any error message

### Requirement: A failed job can be retried by hand

Featherbase SHALL retry a failed job automatically up to a limited number of
attempts; once it has given up, an admin can retry it again by hand.

#### Scenario: Retry after automatic attempts run out

- **WHEN** a job has failed after its automatic attempts are exhausted
- **THEN** an admin can retry it, and it runs again as a fresh attempt

### Requirement: A recurring job runs on a schedule an admin controls

A Scheduled Job SHALL run automatically on the cadence an admin chooses, keep
recurring even if a run fails, and stop once the admin disables it.

#### Scenario: Change how often a job runs

- **WHEN** an admin changes a scheduled job's cadence from daily to hourly
- **THEN** it starts running hourly without needing a restart

#### Scenario: Turn a schedule off

- **WHEN** an admin disables a scheduled job
- **THEN** it stops running until it is enabled again

### Requirement: See whether a schedule is healthy

A Scheduled Job SHALL show when it last ran, whether that run succeeded, and
how long it took, so an admin can tell it's still alive without digging
through logs.

#### Scenario: Check a schedule's last run

- **WHEN** an admin opens a scheduled job
- **THEN** they see its last run time, its outcome, and how long it took
