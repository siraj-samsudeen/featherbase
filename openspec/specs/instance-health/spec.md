# instance-health Specification

## Purpose
System Managers can see, in one place, whether their instance is set up and
working, what is wrong, and since when. Problems stay in view until they are
fixed, and the history shows what broke and when it was fixed.

## Requirements

### Requirement: Instance health page

System Managers SHALL be able to distinguish unfinished setup, optional next
steps and operational faults, with an explanation and next action for each.
The same checks SHALL inform the browser and command-line health report.
Checks SHALL retain coverage of notice recipients, deployment variables,
managed settings and drift, scheduled jobs, and unsafe administrator passwords.

#### Scenario: A new instance being set up

```gherkin
Given the user has a new local instance using built-in defaults
When the user checks its health
Then the user is told the instance is ready to explore
And choosing a managed settings file is offered as an optional next step, not a fault
```

#### Scenario: A developer's own machine

```gherkin
Given the user has a local development instance without email or a warehouse
When the user checks its health
Then absent optional services are explained without being counted as operational faults
And any installed app still identifies the setup it needs
```

#### Scenario: A hosted instance lacking the same things

```gherkin
Given the user has a hosted instance missing required notice recipients
When the user checks its health
Then the user sees that shared use is not ready and how to complete that setup
```

#### Scenario: Chosen managed configuration is not applied

```gherkin
Given the user has chosen file-managed configuration for an instance
And its settings file has never been successfully applied
When the user checks its health
Then the unapplied configuration is reported with the action needed to apply it
```

#### Scenario: Managed settings have drifted

```gherkin
Given the user has applied file-managed configuration to an instance
And a managed setting was changed through an emergency operation
When the user checks its health
Then the differing setting is reported with the action needed to reconcile it
```

### Requirement: The scope provider's Tables exist

Instance health SHALL check, for the one enabled app that provides people's
scope, that every Table it reads for scope and every column it declares reading
from them exists on the instance. While any is missing the check SHALL fail as
an operational fault naming each missing Table and column, and nothing else. On
a developer's own machine, which runs apps before any client's core Tables are
loaded, the check SHALL name what is missing without counting it as a fault.

#### Scenario: An instance lacks a Table the scope provider reads

```gherkin
Given the user has an instance whose scope provider reads a Table the instance does not have
When the user checks its health
Then the missing Table is named as an operational fault, with the warning that no one gets a scope until it exists
And once the Table and its declared columns exist, the check passes
```

### Requirement: Health banner

While an operational fault remains, every System Manager SHALL see a persistent
notice leading to its explanation and remedy. Ordinary first-time setup and
optional configuration SHALL be presented as guidance, not a fault count.

#### Scenario: A failed job

```gherkin
Given the user is a System Manager who has not finished first-time setup
And the last run of an enabled scheduled job failed
When the user opens Featherbase
Then the job failure is visibly reported separately from setup guidance
And the notice remains until a later run succeeds
```

#### Scenario: Other people

```gherkin
Given the user does not have the System Manager role
And an enabled scheduled job has failed
When the user opens Featherbase
Then the user does not see instance administration notices
```

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

The first administrator SHALL be welcomed with a resumable guide to their own
administrator identity, optional apps and shared-instance readiness. They SHALL
be able to explore Featherbase without completing optional steps or installing
an app.

#### Scenario: A fresh instance

```gherkin
Given the user is the first administrator on a fresh local instance
When the user signs in
Then the user sees a welcome guide with clear next steps
And the user can explore Featherbase without installing an app
And the greeting does not present ordinary unfinished setup as health problems
```

#### Scenario: Setup can be resumed

```gherkin
Given the user has deferred optional first-time setup
When the user returns to the setup guide
Then completed configuration is reflected and remaining steps can be continued
```

#### Scenario: Skipped in an emergency

```gherkin
Given the user is the first administrator with setup unfinished
And an enabled scheduled job has failed
When the user skips first-time setup
Then the user reaches Featherbase immediately
And the operational failure remains visibly reported
```

#### Scenario: Email not working yet

```gherkin
Given the user is the first administrator on an instance that cannot send email
When the user invites another System Manager during setup
Then the invitation link is shown to copy and deliver separately
```

#### Scenario: A deep link is not taken over

```gherkin
Given the user is the first administrator with setup unfinished
When the user signs in to follow a saved app link
Then the saved destination is preserved
And the user can open the setup guide separately
```

### Requirement: First-run setup stays reachable while it is needed

While the check for a System Manager's email address is failing, the built-in
Administrator SHALL see a banner linking to the setup screen on every Admin page
but that screen, with no way to dismiss it. Instance health's failing check SHALL
link the Administrator to the setup screen and anyone else to the Person table,
and the Admin sidebar SHALL offer the Administrator the setup screen.

#### Scenario: The sign-in offer was never made

- **WHEN** the Administrator signs in by following a link to Instance health, with the check failing
- **THEN** the page they asked for opens, with the banner and its link to the setup screen

#### Scenario: Deferring setup

- **WHEN** the Administrator chooses "Not now" on the setup screen
- **THEN** the Admin opens, and the banner is there on every page and after signing in again

#### Scenario: Another System Manager

- **WHEN** another System Manager opens Instance health with the check failing
- **THEN** they see no banner, and the check links them to the Person table

#### Scenario: The check passes

- **WHEN** a System Manager gets an email address
- **THEN** the banner and the sidebar link go without a reload

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
