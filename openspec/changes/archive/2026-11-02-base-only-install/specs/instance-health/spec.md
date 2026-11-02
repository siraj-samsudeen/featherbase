# Instance Health

## MODIFIED Requirements

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
