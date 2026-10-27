# instance-health Specification

## Purpose
System Managers can see, in one place, whether their instance is set up and
working, what is wrong, and since when. Problems stay in view until they are
fixed, and the history shows what broke and when it was fixed.

## Requirements

### Requirement: Instance health page

System Managers SHALL have a page listing every health check with its state,
why it matters and how to fix it. Checks include a System Manager with an
email address, recommended deployment variables, the settings file applied,
settings matching the file, the last run of each scheduled job, and the
built-in Administrator's default password.

#### Scenario: A new instance being set up

- **WHEN** a System Manager opens instance health on an instance whose
  settings file has never been applied
- **THEN** that check is failing, says the settings were never applied, and
  says how to apply them

### Requirement: Health banner

While any health check is failing, every System Manager SHALL see a one-line
banner saying how many problems need attention, leading to the health page.
The banner SHALL disappear on its own once every check passes, and SHALL not
be dismissable while a problem remains.

#### Scenario: A failed job

- **WHEN** the last run of the leaver check failed
- **THEN** System Managers see the banner on every page until a later run
  succeeds

#### Scenario: Other people

- **WHEN** a person without the System Manager role signs in while a check is
  failing
- **THEN** they do not see the banner

### Requirement: Health history

Each check SHALL keep a timeline of when it started failing and when it passed
again, so a System Manager can see what broke, for how long, and when it was
fixed.

#### Scenario: A problem fixed overnight

- **WHEN** no System Manager had an email address from Monday morning until
  one was added on Wednesday afternoon
- **THEN** the check's history shows it failing from Monday to Wednesday and
  passing since, with the activity around the fix one step away

### Requirement: Checks run without anyone looking

Health checks SHALL also run on a schedule, so the history is right even when
nobody opens the page.

#### Scenario: A problem that came and went at night

- **WHEN** a scheduled job failed at 2am and succeeded at 3am
- **THEN** the next morning, its history shows it failing for that hour

### Requirement: First-run System Manager setup

While no System Manager has an email address, the built-in Administrator SHALL
be offered a setup step to name one or more System Managers with email
addresses and invite them. The Administrator SHALL be able to skip it, and the
health banner stays while the problem remains.

#### Scenario: A fresh instance

- **WHEN** the built-in Administrator signs in to a new instance
- **THEN** they are asked who looks after the instance, and each person named
  is invited as a System Manager

#### Scenario: Email not working yet

- **WHEN** the Administrator completes the setup on an instance that cannot
  send email yet
- **THEN** each person's invitation link is shown to copy instead

#### Scenario: Skipped in an emergency

- **WHEN** the Administrator skips the setup
- **THEN** they reach the Admin screen at once, and the banner keeps showing the
  problem

### Requirement: Compare environments without revealing secrets

An owner SHALL be able to compare the environments of an instance: their
settings against the file, which declared variables each one has set, and,
for secrets with a rule, whether they match or differ across environments as
the rule says. No secret's value SHALL be shown or kept.

#### Scenario: A dev token that would work on prod

- **WHEN** dev and prod use the same session-signing secret
- **THEN** the comparison reports that this secret must differ between
  environments and does not, without showing the secret

#### Scenario: A web address set on prod but not on dev

- **WHEN** prod has its web address set and dev does not
- **THEN** the comparison reports a problem: set on prod only

#### Scenario: Dev applied from an older settings file

- **WHEN** dev's settings were last applied from an older version of the file
  than prod's
- **THEN** the comparison reports that the two were applied from different
  versions
