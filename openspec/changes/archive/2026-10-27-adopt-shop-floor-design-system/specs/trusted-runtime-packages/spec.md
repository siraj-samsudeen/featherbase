# Trusted Runtime Packages Delta

## ADDED Requirements

### Requirement: An app can give its staff tabs on a phone

An app MAY name the few places its staff move between, each with a short label
and one of Featherbase's icons. On a phone, Featherbase SHALL show them as a
row of tabs within reach of a thumb on that app's pages, with the open one
marked, and SHALL show none for an app that names none or on a wider screen.
An app SHALL NOT be accepted when its tabs could not be shown safely: fewer than
two or more than five, a label too long to fit, or a tab that leads outside the
app.

#### Scenario: A store app's tabs on a phone

- **WHEN** the user opens an app that names "Today" and "Targets" as its tabs,
  on a phone
- **THEN** both tabs show at the bottom of the screen, with the one for the page
  they are on marked, and tapping "Targets" takes them there

#### Scenario: A tab that leads outside the app is refused

- **WHEN** an administrator installs an app whose tab leads to the Admin screens
  or to another site
- **THEN** the app is not accepted, and nothing of it is installed
