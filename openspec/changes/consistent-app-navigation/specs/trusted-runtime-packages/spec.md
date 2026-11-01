# Trusted Runtime Packages

## REMOVED Requirements

### Requirement: An app owns its own screen

**Reason**: The old requirement describes the retired host header and Home icon. Its screen-ownership promises continue below; application switching is covered by App Navigation and keyboard/touch behavior by Usable on Any Device.

**Migration**: App screens use the shared application dropdown rather than a separate Home icon. Featherbase remains a destination for users who can open it.

## ADDED Requirements

### Requirement: An app owns its screen under the shared top bar

An app that brings its own screen SHALL control its address, document, inner navigation state, content and styling outside Featherbase's shared navigation presentation. Featherbase SHALL serve only that app's declared client files, preserve its deep path, query and fragment across sign-in and refresh, and never substitute another screen for a missing piece.

Featherbase SHALL draw the shared top bar above every app screen, including the app's declared bar controls, the theme choice and account menu. Shared navigation styling and theme SHALL remain isolated from the app's content, which SHALL start below the bar without being covered by it.

An app with its own screen SHALL NOT also create a competing generated Home Page; its data remains available to authorized administrators in Featherbase.

#### Scenario: A missing piece stays missing

```gherkin
Given the user is using Tasker
When a piece of Tasker's content cannot load
Then that piece is shown as missing
And neither Tasker's home nor Featherbase replaces it
```

#### Scenario: Signing in returns to the app that was opened

```gherkin
Given the user is signed out
When the user opens a nested Tasker address with a selected task and signs in
Then the same address and selected task survive refreshing the page
```

#### Scenario: An app can be delivered without rebuilding core

```gherkin
Given Featherbase has been built without Tasker's client files
When built Tasker is installed
Then Tasker opens with the shared navigation without rebuilding Featherbase or adding an app-specific platform route
```
