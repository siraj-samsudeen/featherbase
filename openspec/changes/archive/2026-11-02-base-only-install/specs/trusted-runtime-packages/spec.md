# Trusted Runtime Packages

## ADDED Requirements

### Requirement: The platform is named Featherbase

The platform destination SHALL be named Featherbase wherever the user switches
between the platform and installed apps.

#### Scenario: A clean instance identifies the platform

```gherkin
Given the user is a System Manager on an instance with no installed apps
When the user inspects the destination switcher
Then the platform destination is named "Featherbase"
```

#### Scenario: An installed app preserves the platform name

```gherkin
Given the user is a System Manager with Tasker installed
When the user inspects the destination switcher while using Tasker
Then the platform destination is named "Featherbase"
And Tasker retains its own app name
```
