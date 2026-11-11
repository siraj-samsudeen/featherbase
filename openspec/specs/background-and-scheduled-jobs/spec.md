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

### Requirement: Keep a copied table fresh automatically

A System Manager SHALL schedule a copied table at an existing refresh cadence, change the cadence or pause it. Other people SHALL NOT administer its schedule, and nobody SHALL rename its Scheduled Job, whose name ties it to the copied table.

#### Scenario: Plants refresh hourly

```gherkin
Given the user is a System Manager with a copied Plants table
When the user schedules Plants to refresh hourly
Then Plants has one hourly schedule that the user can pause and change
```

#### Scenario: A reader cannot schedule Plants

```gherkin
Given the user can read the copied Plants table but is not a System Manager
When the user tries to schedule Plants to refresh hourly
Then the request is refused and Plants has no new schedule
```

### Requirement: Automatic copies preserve corrections and can be undone

A scheduled copy SHALL use the same refresh operation as a manual copy, preserving personal corrections and recording new source disagreements as conflicts. Each successful run SHALL be one undoable batch attributed to the system rather than a person, including when nothing changed.

#### Scenario: A correction survives an automatic copy

```gherkin
Given the user corrected plant P01 in the copied Plants table
And the source now disagrees with that correction
When the hourly Plants refresh runs
Then the correction is kept and the disagreement is recorded
And the run is one undoable system-attributed batch
```

### Requirement: See what an automatic copy found

Each run SHALL report inserted, changed, unchanged, conflicting and missing-source rows in its execution result. New conflicts SHALL notify the responsible administrators without disclosing copied values.

#### Scenario: The next copy finds no changes

```gherkin
Given the copied Plants table and its source both contain the same two plants
When the hourly Plants refresh runs
Then the execution reports two unchanged rows and no changed rows
```

#### Scenario: A new disagreement reaches an administrator

```gherkin
Given the user corrected plant P01 in the copied Plants table
And the source now disagrees with that correction
When the hourly Plants refresh runs
Then the responsible administrators receive a notice naming Plants and its new conflict count
```

### Requirement: Failed copies leave the last successful data intact

A failed copy SHALL leave data, conflict observations and import batches untouched and use the existing failure alert and retry behavior. This applies to both scheduled and manual copies, including a failure after earlier candidate rows were processed.

#### Scenario: A later plant fails validation

```gherkin
Given the copied Plants source has a valid changed plant P01 followed by an invalid plant P02
When the hourly Plants refresh runs
Then the execution fails and Plants still has its previous values
And no batch or conflict from that failed run is retained
```

### Requirement: Missing source rows are observations rather than personal edits

A successful complete source read SHALL mark absent rows as deleted at source without removing them, even when the source is empty. Those observations SHALL be undoable and SHALL NOT become personal corrections.

#### Scenario: The source has no plants left

```gherkin
Given the copied Plants table contains plant P01 and its source is now empty
When the hourly Plants refresh runs
Then plant P01 is marked deleted at source in an undoable system-attributed batch
```

### Requirement: Removed copies do not keep running

Removing a copied table or its source SHALL withdraw its refresh schedule and pending work. A stale run SHALL NOT recreate removed data.

#### Scenario: Plants is removed before its next refresh

```gherkin
Given the copied Plants table has an hourly schedule
When the user removes Plants
Then its schedule and pending refresh are removed
```

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
