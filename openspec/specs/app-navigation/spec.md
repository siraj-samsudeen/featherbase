# app-navigation Specification

## Purpose
People move between the applications they can access and Featherbase through
consistent navigation, while keeping each application's own work and selection
state intact.

## Requirements

### Requirement: Change applications from the shared navigation

The user SHALL change between accessible applications and Featherbase through the existing application-name dropdown on both Tasker and Dash, without a separate administration control or duplicate platform link. Unavailable applications and destinations the user cannot access SHALL NOT be offered.

#### Scenario: Featherbase is a destination alongside the applications

```gherkin
Given the user can open Featherbase, Tasker and Dash
When the user chooses Featherbase from Tasker's application name
Then Featherbase opens
And no separate administration control is offered on Tasker
```

#### Scenario: A reader sees only accessible destinations

```gherkin
Given the user can open Tasker and Dash but cannot open Featherbase
When the user opens the application choices in Dash
Then Tasker and Dash are offered
But Featherbase is not offered
```

### Requirement: Applications share app-focused navigation

Tasker and Dash SHALL each use one app-focused sidebar with Featherbase's shared navigation presentation rather than competing platform menus. Tasker SHALL retain its task views, counts and project navigation; Dash SHALL retain its store selection alongside the application choice and its report destination in the shared navigation.

#### Scenario: Tasker keeps its project work

```gherkin
Given the user can open Tasker and Dash but cannot open Featherbase
And Tasker has a project named September stock review with two tasks
When the user opens September stock review through the shared navigation
Then the project's two tasks are shown
And the shared navigation identifies September stock review as current
```

#### Scenario: Dash keeps the selected store

```gherkin
Given the user can open Tasker and Dash but cannot open Featherbase
And the user has selected Lakeside in Dash
When the user opens the report through the shared navigation
Then Lakeside remains selected
And Dash shows the report state for Lakeside
```

### Requirement: Every page shares one sidebar chrome

Featherbase Admin, the account pages and every app SHALL share one chrome, the sidebar, with no top bar beside it on a wide window. Its top SHALL hold the application switcher and its foot the account. Every sidebar SHALL collapse to a rail of its icons by its own control or `Ctrl+B` / `Cmd+B`, never while the user types in a field, remembered per person in that browser across applications. At phone width it SHALL be a drawer opened from a slim header holding only its menu button.

#### Scenario: The sidebar collapses the same way in every application

```gherkin
Given the user can open Tasker and Dash but cannot open Featherbase
When the user presses Ctrl+B in Tasker
Then Tasker's navigation shows only its icons
When the user opens Dash
Then Dash's navigation shows only its icons too
When the user expands the sidebar from the sidebar itself
Then Dash's navigation is shown in full
```

#### Scenario: Typing keeps the shortcut for the field

```gherkin
Given the user can open Tasker and Dash but cannot open Featherbase
When the user presses Ctrl+B while typing in Tasker's search
Then Tasker's navigation stays shown
```

#### Scenario: The account pages carry the application switcher

```gherkin
Given the user can open Tasker and Dash but cannot open Featherbase
When the user opens Sign-in methods from Dash's account menu
Then the application name shows Dash
And Tasker is offered beside it
```

### Requirement: An address nothing answers says so

An address the server cannot open as an app SHALL lead to the shared page that
says nothing is available there, under the top bar, in the person's theme. The
address is repeated as text only. That an app is turned off is said only to
someone who could use it; signed out, or without access, nothing tells whether
an app exists. The page offers one way forward (#1328).

#### Scenario: A mistyped address

- **WHEN** an administrator opens `/equipment/`
- **THEN** the page reads "Nothing is available at /equipment/" with "Go to Featherbase"

#### Scenario: An app that is turned off

- **WHEN** an administrator opens a turned-off app's address
- **THEN** the page reads "<App> is turned off" and asks them to ask their system manager

#### Scenario: Signed out

- **WHEN** someone signed out opens a turned-off app's address
- **THEN** the page reads "Nothing is available at" that address, with no top bar, exactly as for an address no app has
