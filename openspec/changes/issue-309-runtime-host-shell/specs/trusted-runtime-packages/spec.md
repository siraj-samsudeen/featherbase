## MODIFIED Requirements

### Requirement: An app owns its own screen

An app that brings its own screen SHALL fully control its address, document,
inner navigation and styling. Featherbase SHALL serve only that app's declared
client files, SHALL NOT show one app's screen or its own in place of a missing
piece, and SHALL preserve an app-owned deep path, query and fragment across
sign-in and refresh while loading the app's entry document.

Featherbase SHALL render every app screen inside its responsive host shell on
desktop and touch/mobile. The shell SHALL keep a persistent Featherbase Home
icon immediately followed by one keyboard-operable app switcher. The switcher
SHALL identify the current destination and contain Featherbase Home plus every
active installed app the current member is allowed to open. It SHALL refresh
after the document regains focus or visibility, omit unavailable destinations,
and return to Featherbase Home if the current destination becomes unavailable.

The Home destination SHALL be the single responsive route to Featherbase's
ordinary host controls; neither the shell nor an app SHALL create a second app
list. Shell controls SHALL have accessible names, visible keyboard focus and
usable touch targets without obscuring or replacing app-owned content. An app
with its own screen SHALL NOT also create a competing generated Home Page; its
tables remain available to administrators.

#### Scenario: A missing piece stays missing

- **WHEN** something inside Tasker's screen fails to load
- **THEN** it shows as missing
- **AND** neither Tasker's own home screen nor Featherbase's is shown instead

#### Scenario: Signing in returns to the app that was opened

- **WHEN** a signed-out person opens a nested Tasker address with query state
  and a selected task in its fragment
- **THEN** after signing in and refreshing they remain at that exact address
  with the selected task open

#### Scenario: Every app opens in the host shell

- **WHEN** an authorized member opens an app on desktop or touch/mobile
- **THEN** the Home icon and unified app switcher remain available while the
  app's own navigation and content render unchanged below them

#### Scenario: The switcher follows current access

- **WHEN** app access is granted, removed, disabled, made unavailable or
  restored before the document regains focus or visibility
- **THEN** the refreshed switcher contains Featherbase Home plus exactly the
  active installed apps that member can open
- **AND** if the current app disappeared, the member returns to Featherbase Home

#### Scenario: Host controls work with keyboard and touch

- **WHEN** a member uses the shell on desktop or a touch/mobile viewport
- **THEN** Home and the switcher have accessible names, visible focus and
  usable targets, and app-owned controls remain operable

#### Scenario: Home restores Featherbase controls

- **WHEN** a member activates the Home icon or chooses Featherbase Home
- **THEN** they reach Featherbase's responsive navigation, command, account,
  appearance, language, notification and permitted administration controls

#### Scenario: An app can be delivered without rebuilding core

- **WHEN** built Tasker is staged after Featherbase core was built
- **THEN** Tasker opens inside the host shell without a core rebuild or a
  Tasker-specific core route
