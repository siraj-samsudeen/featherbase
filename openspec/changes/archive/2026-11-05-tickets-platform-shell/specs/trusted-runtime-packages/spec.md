# Trusted runtime packages

## ADDED Requirements

### Requirement: An app can choose its accent colour

An **App** SHALL be able to name an **accent**, one of the colours Featherbase provides, each made readable in light and dark. The accent SHALL colour the app's buttons and selected items, on its own page and in the shared bar and navigation over it. It SHALL leave the colours that carry meaning (errors, warnings, success) and every other app unchanged. An app that names no accent keeps Featherbase's own, and an accent Featherbase does not provide is refused when the app is installed.

#### Scenario: An app's page and navigation take its accent

```gherkin
Given Tickets names the green accent
When the user opens Tickets
Then Tickets' main buttons and its selected view in the shared navigation are green
When the user switches to the dark theme in the shared bar
Then they are the dark theme's green
```

#### Scenario: An app that names no accent keeps Featherbase's

```gherkin
Given Tasker names no accent
When the user opens Tasker
Then Tasker's selected view in the shared navigation is Featherbase's own blue
```

#### Scenario: An accent Featherbase does not provide is refused

```gherkin
Given an app names an accent that Featherbase does not provide
When a System Manager installs that app
Then the installation is refused and names the accents Featherbase provides
```
