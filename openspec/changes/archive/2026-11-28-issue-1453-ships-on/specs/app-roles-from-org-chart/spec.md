# App Roles From The Org Chart

## REMOVED Requirements

### Requirement: Each app role from the org chart is turned on by a System Manager
**Reason**: The owner chose that it ships on (28-Nov-2026); replaced by "An app role from the org chart starts on, visibly, and a System Manager can turn it off".
**Migration**: None; installs and upgrades now write the rule themselves.

## ADDED Requirements

### Requirement: An app role from the org chart starts on, visibly, and a System Manager can turn it off
Installing an app, or an upgrade that first declares a role the org chart gives, SHALL turn that role on and record it in the activity log, and an upgrade's preview SHALL list it. A System Manager SHALL be able to turn it off by removing its rule; only a role the app created SHALL be given.

#### Scenario: Installed, the role is on

```gherkin
Given an app declares that the org chart gives "Chart Reader"
When the app is installed and the rule's job runs
Then everyone the org chart gives a place holds "Chart Reader"
And the activity log says the role was turned on
```

#### Scenario: Turned off by a System Manager

```gherkin
Given people hold "Chart Reader" from the org chart
When a System Manager removes its rule
Then none of them holds "Chart Reader" through it
```

#### Scenario: A role the app only adopted is never given

```gherkin
Given the instance already had a role named "Chart Reader" before the app was installed
When the app is installed and the rule's job runs
Then nobody holds "Chart Reader" from the org chart
```
