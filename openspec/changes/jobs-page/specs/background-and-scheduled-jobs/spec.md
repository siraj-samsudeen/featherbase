## ADDED Requirements

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

When a scheduled job's run fails for good or refuses, Featherbase SHALL email every System Manager once, in plain words: which job, when, and what failed. When no System Manager has an email address, that is recorded rather than lost.

#### Scenario: A nightly job fails

- **WHEN** a scheduled job fails on every attempt
- **THEN** each System Manager gets one email naming the job and the error, not one per attempt

## MODIFIED Requirements

### Requirement: See whether a schedule is healthy

A Scheduled Job SHALL show when it last ran, whether that run succeeded, failed or refused, what it came to in one line, and how long it took, so an admin can tell it's still alive without digging through logs.

#### Scenario: Check a schedule's last run

- **WHEN** an admin opens a scheduled job
- **THEN** they see its last run time, its outcome and result, and how long it took
