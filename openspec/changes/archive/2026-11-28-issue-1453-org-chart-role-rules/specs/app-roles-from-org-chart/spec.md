# App Roles From The Org Chart

## ADDED Requirements

### Requirement: Each app role from the org chart is turned on by a System Manager
A role an app declares the org chart may give SHALL be given only while a System Manager's rule for that app and role stands, and only if the app created the role when it was installed. An upgrade SHALL list the roles it adds to or removes from what the org chart may give.

#### Scenario: An upgrade cannot give a role unseen

```gherkin
Given an upgrade of an app declares that the org chart may give "Chart Reader"
And no System Manager has added a rule for it
When the rule's job runs
Then nobody holds "Chart Reader" from the org chart
```

#### Scenario: A role the app only adopted is never given

```gherkin
Given the instance already had a role named "Chart Reader" before the app was installed
And a System Manager adds a rule for it
When the rule's job runs
Then nobody holds "Chart Reader" from the org chart
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
