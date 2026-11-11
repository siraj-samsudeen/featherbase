# App Navigation

## MODIFIED Requirements

### Requirement: Change applications from the shared navigation

The user SHALL change between accessible applications and Featherbase through the existing application-name dropdown in every application, such as Tasker or Store Reports (an application that lets the user pick a store), without a separate administration control or duplicate platform link. Unavailable applications and destinations the user cannot access SHALL NOT be offered.

#### Scenario: Featherbase is a destination alongside the applications

```gherkin
Given the user can open Featherbase, Tasker and Store Reports
When the user chooses Featherbase from Tasker's application name
Then Featherbase opens
And no separate administration control is offered on Tasker
```

#### Scenario: A reader sees only accessible destinations

```gherkin
Given the user can open Tasker and Store Reports but cannot open Featherbase
When the user opens the application choices in Store Reports
Then Tasker and Store Reports are offered
But Featherbase is not offered
```

## REMOVED Requirements

### Requirement: Applications share app-focused navigation

**Reason**: It names a client's app, Dash, which is leaving this repository.

**Migration**: Replaced by "Applications keep their work in the shared navigation", which makes the same promise about an application with a store picker.

## ADDED Requirements

### Requirement: Applications keep their work in the shared navigation

Each application SHALL use one app-focused sidebar with Featherbase's shared navigation presentation rather than competing platform menus. Tasker SHALL retain its task views, counts and project navigation; an application with a picker in the shared bar, such as Store Reports' store, SHALL keep that selection when the user follows its destinations in the shared navigation.

#### Scenario: Tasker keeps its project work

```gherkin
Given the user can open Tasker and Store Reports but cannot open Featherbase
And Tasker has a project named September stock review with two tasks
When the user opens September stock review through the shared navigation
Then the project's two tasks are shown
And the shared navigation identifies September stock review as current
```

#### Scenario: The selected store is kept

```gherkin
Given the user can open Tasker and Store Reports but cannot open Featherbase
And the user has selected Lakeside in Store Reports
When the user opens the store report through the shared navigation
Then Lakeside remains selected
And Store Reports shows the report for Lakeside
```
