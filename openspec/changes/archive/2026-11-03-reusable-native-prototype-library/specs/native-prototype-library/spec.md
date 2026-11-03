# Native Prototype Library

## ADDED Requirements

### Requirement: Discover available components

The library SHALL show working examples of actual Featherbase components and their reuse locations. The user SHALL be able to search the examples by name or purpose.

#### Scenario: Find a list example

```gherkin
Given the user is exploring the native prototype library
When the user searches the examples for "list"
Then the user sees matching working examples and their reuse locations
And unrelated examples are excluded
```

### Requirement: Work in the available content area

Prototype collections SHALL use the available content area under Featherbase navigation rather than placing working lists inside cramped detail cards. Each potentially long collection SHALL have a visible search, and the user SHALL retain their place when switching sections or returning from related information.

#### Scenario: Return to a searched collection

```gherkin
Given the user has searched the prototype collection for "North"
When the user opens an item and follows its related collection
Then the user can follow the trail back to the original collection
And the original search and selected section are retained
```

### Requirement: Explore safely with synthetic examples

The synthetic preview SHALL clearly identify invented data and simulated access restrictions, offer resettable populated, empty, loading, failed and permission-limited states, and never forward unhandled requests to a real account. Prototype approval SHALL NOT be presented as proof of server authorization or persistence.

#### Scenario: Reset a local edit

```gherkin
Given the user is exploring the populated synthetic prototype
When the user edits an example and resets the prototype
Then the original synthetic example is restored
And the preview states that access restrictions are simulated
```

#### Scenario: Unsupported actions cannot reach real accounts

```gherkin
Given the user is exploring the synthetic prototype
When an action has no synthetic response
Then the action is refused without contacting a real account
And the user is not told that the action succeeded
```

### Requirement: Retain the screen for integration

An interactive example SHALL use the same actual Featherbase screen with synthetic responses and with an isolated real server. Table lists and forms SHALL remain metadata-driven; non-Table collections SHALL reuse shared controls rather than imitate Table screens.

#### Scenario: Use the same row form with real data

```gherkin
Given the user has explored a row form in the synthetic prototype
When the same screen is connected to an isolated real server
Then the row form retains its controls and layout
And a saved change is still visible after reloading
```
