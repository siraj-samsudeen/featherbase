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

### Requirement: Queued work is picked up without anyone asking

Once work is queued as a background job, Featherbase SHALL pick it up and run
it on its own; nobody has to start it by hand.

#### Scenario: A queued job gets done

- **WHEN** a job is queued
- **THEN** it soon shows as done without anyone running it

### Requirement: See every job's status in one place

An admin SHALL see every background job's status, how many attempts it's
had, and any error, in one list.

#### Scenario: Check what's running

- **WHEN** an admin opens the background jobs list
- **THEN** each job shows whether it's queued, running, done or failed, its
  attempt count, and any error message

### Requirement: A failed job can be retried by hand

Featherbase SHALL retry a failed job automatically up to a limited number of
attempts; once it has given up, an admin can retry it again by hand. Only a
System Manager can do that, or start a job by hand.

#### Scenario: A job that fails twice then works

- **WHEN** a job fails on its first two attempts and succeeds on its third
- **THEN** it ends up done, and its attempt count shows three

#### Scenario: Someone without the role tries to retry

- **WHEN** a person who is not a System Manager tries to retry a failed job
- **THEN** it is refused and the job stays failed

#### Scenario: Retry after automatic attempts run out

- **WHEN** a job has failed after its automatic attempts are exhausted
- **THEN** an admin can retry it, and it runs again as a fresh attempt

### Requirement: A job started by hand doesn't move the schedule

An admin SHALL be able to run a job on demand without starting a second
repeating copy of it, so the schedule keeps its own rhythm.

#### Scenario: Run a scheduled job now

- **WHEN** an admin starts a scheduled job by hand while its next scheduled
  run is waiting
- **THEN** it runs once now, and exactly one scheduled run is still waiting
  afterward

### Requirement: A recurring job runs on a schedule an admin controls

A Scheduled Job SHALL run automatically on the cadence an admin chooses, keep
recurring even if a run fails, and stop once the admin disables it.

#### Scenario: Change how often a job runs

- **WHEN** an admin changes a scheduled job's cadence from daily to hourly
- **THEN** it starts running hourly without needing a restart

#### Scenario: Turn a schedule off

- **WHEN** an admin disables a scheduled job
- **THEN** it stops running until it is enabled again

#### Scenario: A failed run doesn't end the schedule

- **WHEN** a scheduled job's run fails every attempt
- **THEN** its next run is still scheduled

### Requirement: A schedule's cadence comes from a fixed list

An admin SHALL choose a scheduled job's cadence from a short fixed list, such
as hourly or daily, never by typing a number of seconds. Anything else is
refused beside the cadence field.

#### Scenario: A made-up cadence

- **WHEN** an admin saves a scheduled job with a cadence that isn't on the
  list
- **THEN** the save is refused and the message points at the cadence

### Requirement: See whether a schedule is healthy

A Scheduled Job SHALL show when it last ran, whether that run succeeded, failed or refused, what it came to in one line, and how long it took, so an admin can tell it's still alive without digging through logs.

#### Scenario: Check a schedule's last run

- **WHEN** an admin opens a scheduled job
- **THEN** they see its last run time, its outcome and result, and how long it took

### Requirement: Manage every scheduled job from one page

A System Manager SHALL see every scheduled job on one page, with its schedule and when it runs next, how its last run went, and a one-line result. From there they can switch a job on or off and run it now.

#### Scenario: Pause a job and run it by hand

- **WHEN** a System Manager switches the leaver check off, then runs it now
- **THEN** it runs once, its last run and result show on the page, and it does not run again on its own until it is switched back on

### Requirement: A run that refuses to act counts as a failure

A job SHALL be able to refuse a run when acting would be unsafe. A refused run changes nothing, is shown as refused, and is treated like a failure, but it is not retried and the schedule carries on.

#### Scenario: The leaver check refuses on a stale feed

- **WHEN** the leaver check runs while the warehouse data it reads is three days old
- **THEN** it disables nobody, its last run shows as refused with the reason, and it runs again at its next scheduled time

### Requirement: A failed run emails the System Managers

When a scheduled job's run fails for good or refuses, Featherbase SHALL email every System Manager once, in plain words: which job, when, and what failed. A job that keeps failing the same way run after run is emailed about once, when it starts. When no System Manager has an email address, that is recorded rather than lost.

#### Scenario: A nightly job fails

- **WHEN** a scheduled job fails on every attempt
- **THEN** each System Manager gets one email naming the job and the error, not one per attempt

#### Scenario: A job keeps failing

- **WHEN** a job that runs every 15 minutes fails all morning
- **THEN** the System Managers get one email when it starts failing, and another only if it fails again after a run that worked
