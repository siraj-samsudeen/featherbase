## RENAMED Requirements

- FROM: `### Requirement: Every page shares one top bar and sidebar`
- TO: `### Requirement: Every page shares one sidebar chrome`

## MODIFIED Requirements

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
