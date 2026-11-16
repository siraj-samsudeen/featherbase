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
