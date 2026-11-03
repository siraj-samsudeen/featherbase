# Search and Explore

## ADDED Requirements

### Requirement: Navigation history follows the current instance

The user's recent and frequent destinations SHALL follow the instance's saved history on each app load and sign-in, replacing the browser's remembered history even when the instance has none. Visits not yet included in that history MUST remain available.

A saved visit MUST count only once even when the browser's clock differs from the instance's clock. A delivery acknowledgement alone MUST NOT discard a visit missing from an earlier history snapshot.

#### Scenario: Old destinations disappear after history is cleared

```gherkin
Given the user has remembered visits to the Person destination
And the instance has forgotten the user's visits
When the user reloads the app
Then the user's navigation history has no Person destination
```

#### Scenario: Current history replaces old remembered destinations

```gherkin
Given the browser remembers an old destination absent from the instance history
And the instance remembers the user's Person destination
When the user reloads the app
Then the user's navigation history contains Person but not the old destination
```

#### Scenario: A new visit survives a history refresh

```gherkin
Given the user's history is loading
When the user opens the Person destination before history finishes loading
Then the Person destination remains in the user's navigation history
```

### Requirement: Unconfirmed cached history stays hidden

The user's cached navigation history MUST remain hidden until the initial history request finishes. If that request fails, the user SHALL be offered the remembered history as a best-effort fallback.

#### Scenario: Old destinations never flash while history loads

```gherkin
Given the browser remembers an old destination absent from the instance history
When the user's history is still loading
Then neither navigation surface offers the old destination
```

#### Scenario: Remembered destinations remain usable when history fails

```gherkin
Given the user has remembered visits to the Person destination
When the initial history request fails
Then both navigation surfaces offer the Person destination
```
