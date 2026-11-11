# Running an Instance

## ADDED Requirements

### Requirement: A code-only fix reaches production without a new version

A deploy SHALL take an app's changed code under the same version on production as on dev, when what
the app declares (its tables, roles and grants) is unchanged. A change to what it declares SHALL
still need a new version.

#### Scenario: Production takes a fixed screen under the same version

```gherkin
Given production runs version 1 of an app
When a deploy ships version 1 with one of its files changed
Then production runs the changed files, still as version 1
```

#### Scenario: Production still refuses a changed declaration under the same version

```gherkin
Given production runs version 1 of an app
When a deploy ships version 1 with a changed declaration
Then the deploy is refused and asks for a new version
```
