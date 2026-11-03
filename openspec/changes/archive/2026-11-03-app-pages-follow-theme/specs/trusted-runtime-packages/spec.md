# Trusted Runtime Packages

## ADDED Requirements

### Requirement: An app's page follows the person's theme

An app's page SHALL be told which theme, light or dark, the person sees: when the page opens and whenever it
changes, without a reload. When the person has chosen to follow the device, the theme told is the device's.
Featherbase SHALL NOT restyle the app's page itself; the app decides how to follow.

#### Scenario: The app's page follows the person's choice over the device's

```gherkin
Given the user has chosen the light theme on a device set to dark
When the user opens an app's page that follows the theme
Then the app's page is light
```

#### Scenario: A theme change reaches the open app's page

```gherkin
Given the user is on an app's page that follows the theme, in the light theme
When the user switches to the dark theme in the shared bar
Then the app's page turns dark without reloading
```
