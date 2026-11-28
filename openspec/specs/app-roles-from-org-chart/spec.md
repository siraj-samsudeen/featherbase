# app-roles-from-org-chart Specification

## Purpose
An app's roles come from the organisation's own records, kept in step with them, so no one grants them person by person.

## Requirements

### Requirement: An app role is held by everyone the org chart gives a place, once the instance turns it on
An app SHALL be able to declare which of its own roles everyone the org chart gives a place holds. While the instance has the rule turned on, each such person SHALL hold those roles, and SHALL lose them once the org chart gives them no place or they are disabled. While it is off, nobody SHALL hold a role through it.

#### Scenario: A Team Leader holds the role without a grant

```gherkin
Given an app declares that everyone with a place on the org chart holds "Chart Reader"
And the org chart gives a made-up Team Leader a place at store "N1"
And the instance has turned the rule on
When the rule runs
Then the Team Leader holds "Chart Reader"
And someone the org chart gives no place does not
```

#### Scenario: A leaver loses the role

```gherkin
Given a person holds "Chart Reader" from the org chart
When their place ends, or they are disabled, and the rule runs again
Then they no longer hold "Chart Reader"
```

#### Scenario: Turned off, nobody holds it through the rule

```gherkin
Given people hold "Chart Reader" from the org chart
When the instance turns the rule off
Then none of them holds "Chart Reader" through it
```

### Requirement: An administrator sees who holds an app role from the org chart and why
The holders SHALL be listed with the app, the role and the places that gave it, readable by a System Manager and edited by nobody.

#### Scenario: Why a person holds the role

```gherkin
Given a made-up Team Leader holds "Chart Reader" from the org chart
When a System Manager opens App Roles From The Org Chart
Then the Team Leader's row says "1 place on the org chart: North kids"
```

### Requirement: A run that cannot read the org chart keeps the last holders
A run SHALL change no holder when the instance's scope provider is missing, not set up, or cannot answer for anyone, and SHALL fail saying so.

#### Scenario: The org chart is unreachable for a day

```gherkin
Given a made-up Team Leader holds "Chart Reader" from the org chart
When the scope provider fails and the rule's job runs
Then the run fails saying the last holders stand
And the Team Leader still holds "Chart Reader"
```

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
