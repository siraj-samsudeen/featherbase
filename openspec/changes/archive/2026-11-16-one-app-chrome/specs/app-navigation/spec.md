## ADDED Requirements

### Requirement: Every page shares one top bar and sidebar

Featherbase Admin, the account pages and every installed app SHALL show the same top bar, with the application switcher on every signed-in page. Every page with a sidebar SHALL offer the same way to collapse it: the top bar's control and `Ctrl+B` or `Cmd+B`, never while the user is typing in a field. The choice SHALL be remembered for that person in that browser, across applications. At phone width the sidebar SHALL be a drawer opened from the top bar.

#### Scenario: The sidebar collapses the same way in every application

```gherkin
Given the user can open Tasker and Dash but cannot open Featherbase
When the user presses Ctrl+B in Tasker
Then Tasker's navigation is hidden
When the user opens Dash
Then Dash's navigation is hidden too
When the user expands the sidebar from the top bar
Then Dash's navigation is shown
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
