# Usable on Any Device

## ADDED Requirements

### Requirement: Filters fold away on a phone

On a phone, a list's filter controls SHALL stay folded until the user opens them, so they don't push its rows down. The
folded control SHALL say how many filters are in use.

#### Scenario: Section Mapping's rows come straight after the folded filters

```gherkin
Given the user is on a phone
When the user opens the list of "Section Mapping"
Then no filter control shows, and the rows come straight after the folded filters
When the user opens the filters
Then every quick filter shows, one above the other, and the user can add a filter
```

#### Scenario: The folded control says 2 filters are in use

```gherkin
Given the user is on a phone
And the user has filtered "Section Mapping" by Floor and by Owner
When the filters are folded
Then the user can see that 2 filters are in use
```
