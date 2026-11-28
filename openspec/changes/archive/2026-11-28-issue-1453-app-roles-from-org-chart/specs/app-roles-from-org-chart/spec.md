# App Roles From The Org Chart

## ADDED Requirements

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
