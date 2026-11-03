# Admin UI Feedback

## ADDED Requirements

### Requirement: Find every permitted destination

The Admin search SHALL find every independently openable page and Table available to the user by its readable name, including settings, visible Home Pages, installed available apps and their declared tabs. It SHALL distinguish destination kinds, avoid duplicate destinations and omit unavailable destinations, child Tables and choices requiring an existing selection.

#### Scenario: Instance health opens from search

```gherkin
Given the user manages the instance
When the user finds Instance health through the command bar
Then the instance health page is shown without the command dropdown
```

#### Scenario: Settings opens its existing form

```gherkin
Given the user manages the instance
When the user finds System Settings through the command bar
Then the existing System Settings form is shown
```

#### Scenario: Unavailable pages are absent

```gherkin
Given the user can read Person but cannot manage the instance
When the user searches for Instance health through the command bar
Then Instance health is not offered
```

### Requirement: Dismiss results without losing the search

An outside pointer action or Escape from anywhere in the command bar SHALL close its results without erasing the query. Later results SHALL NOT reopen it until the user focuses the search or uses its shortcut; moving between results SHALL keep them usable.

#### Scenario: An outside click preserves the search

```gherkin
Given the user is searching for access in the command bar
When the user clicks outside the command bar
Then its results are hidden with the search preserved
And focusing the command bar shows its results again
```

#### Scenario: Escape from a focused result preserves the search

```gherkin
Given the user is searching for access in the command bar
When the user focuses a result and presses Escape
Then its results are hidden with the search preserved
And the command shortcut shows its results again
```

#### Scenario: Escape from the search preserves the search

```gherkin
Given the user is searching for access in the command bar
When the user presses Escape in the search
Then its results are hidden with the search preserved
And the command shortcut shows its results again
```
