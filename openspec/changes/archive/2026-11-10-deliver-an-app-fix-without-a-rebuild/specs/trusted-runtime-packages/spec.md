# Trusted Runtime Packages

## ADDED Requirements

### Requirement: An app's code fix can be delivered to a running instance

The deploy pipeline, holding the instance's deploy key, SHALL be able to deliver an app's changed
code for the version installed, and the instance SHALL serve it at once, without a rebuild or a
restart. Without the key, or when the delivery changes what the app declares, it SHALL be refused
and nothing SHALL change.

#### Scenario: A delivered fix is live at once

```gherkin
Given version 1 of an app is installed and running
When the deploy pipeline delivers version 1 with its page changed
Then the app's page shows the change at once, still as version 1
```

#### Scenario: A delivery without the deploy key is refused

```gherkin
Given version 1 of an app is installed and running
When someone delivers version 1 with its page changed but without the deploy key
Then the delivery is refused and the app's page is unchanged
```

#### Scenario: A delivery that changes what the app declares is refused

```gherkin
Given version 1 of an app is installed and running
When the deploy pipeline delivers version 1 with a changed declaration
Then the delivery is refused, asks for an ordinary deploy, and the app's page is unchanged
```
