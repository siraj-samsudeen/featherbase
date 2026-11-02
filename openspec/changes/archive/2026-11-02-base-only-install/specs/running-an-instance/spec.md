# Running an Instance

## ADDED Requirements

### Requirement: Start with only the platform

Starting a new instance without choosing any apps SHALL provide only
Featherbase. Example apps, client apps and test apps SHALL require an explicit choice.

#### Scenario: A fresh checkout opens only Featherbase

```gherkin
Given the user has a fresh checkout and an empty development instance
When the user starts Featherbase without choosing an instance or any apps
Then the user can sign in to Featherbase
And no example app, client app or test app is installed
And no client app or test app was built by the startup command
```

#### Scenario: Starting again keeps a chosen app

```gherkin
Given the user has explicitly installed Tasker on a development instance
When the user starts Featherbase again without choosing an instance or any apps
Then Tasker and its existing tasks are still installed
```

### Requirement: Discover the command line without prior knowledge

The command line SHALL introduce itself as Featherbase and show a small set of
plain-language starting actions before advanced administration. Help SHALL work
before a database is configured, and an unknown command SHALL fail with a useful next action.

#### Scenario: The user has not chosen a command

```gherkin
Given the user has installed the checkout dependencies but has not configured a database
When the user opens Featherbase command-line help
Then the user sees how to prepare an instance, start it and check its health
And each action explains what it does and what to run next
And help does not require a database connection
```

#### Scenario: A command is mistyped

```gherkin
Given the user has installed the checkout dependencies
When the user enters an unknown Featherbase command
Then the command fails and points to the relevant help
And no setup or installation is performed
```

### Requirement: Prepare a local instance deliberately

The user SHALL be able to prepare a platform-only local instance with one
repeatable command, with a clear summary of changes and the next action.

#### Scenario: Setup is safe to repeat

```gherkin
Given the user has prepared a local Featherbase instance
When the user runs the preparation command again
Then existing data and installed apps are preserved
And the user is told what changed and how to start the instance
```

### Requirement: Read a useful health report from the command line

The user SHALL be able to read setup readiness and operational health without
opening the browser. The command SHALL provide a machine-readable report and
fail when an operational fault or required setup prevents the intended use.

#### Scenario: A clean local instance needs no optional services

```gherkin
Given the user has a new local instance using built-in defaults
When the user checks its health from the command line
Then the report succeeds and says it is ready to explore
And optional configuration is reported separately from faults
```

#### Scenario: A real failure is actionable for a person or an agent

```gherkin
Given the user has a local instance with an enabled scheduled job whose last run failed
When the user requests a machine-readable command-line health report
Then the command fails and the report identifies the failed check and next action
And the report does not contain secret values
```

#### Scenario: Required hosted setup is not ready

```gherkin
Given the user has a hosted instance missing required notice recipients
When the user requests a machine-readable command-line health report
Then the command fails with a setup-readiness finding and the next action
And the missing setup is distinguished from an operational fault
```
