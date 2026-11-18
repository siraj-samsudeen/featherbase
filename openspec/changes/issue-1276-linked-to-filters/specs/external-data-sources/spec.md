## REMOVED Requirements

### Requirement: Explore follows linked rows within one connected Postgres source

**Reason**: Explore is retired (#1276); the list's Linked to filter follows the same links.
**Migration**: "A list follows linked rows within one connected Postgres source".

## ADDED Requirements

### Requirement: A list follows linked rows within one connected Postgres source

A list's Linked to filter SHALL follow direct links within one Postgres data source over all matching linked records, with exact totals and groups and the same access restrictions at every step. Other sources, indirect links and requests beyond the existing limits SHALL remain refused; selecting records and summing values remain unchanged.

#### Scenario: All connected floors appear before selecting a store

```gherkin
Given a connected Postgres source has North with two floors, South with one floor and Empty with none
When the user lists the floors linked to any store
Then the user sees the three linked floors with a total of three
```

#### Scenario: Selecting a store narrows its floors

```gherkin
Given a connected Postgres source has North with two floors, South with one floor and Empty with none
When the user lists the floors linked to North
Then the user sees only North's two floors with a total of two
```

#### Scenario: Selecting an empty store shows no floors

```gherkin
Given a connected Postgres source has North with two floors, South with one floor and Empty with none
When the user lists the floors linked to Empty
Then the user sees no floors with a total of zero
```

#### Scenario: An empty upstream search shows no floors

```gherkin
Given a connected Postgres source has North with two floors, South with one floor and Empty with none
When the user lists the floors linked to stores matching "Missing"
Then the connected result has no floors with a total of zero
```

#### Scenario: A store beyond the displayed page still contributes its floors

```gherkin
Given a connected Postgres source has more than five hundred stores
When the user lists the floors linked to any store of that source
Then floors linked to stores beyond the displayed page contribute to the exact result
```
