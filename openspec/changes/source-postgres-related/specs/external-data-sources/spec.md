# External Data Sources

## ADDED Requirements

### Requirement: Explore follows linked rows within one connected Postgres source

The server SHALL evaluate direct Reference relationship filters within one PostgreSQL Data Source record over the complete filtered upstream set, including nesting and exact counts/groups. Every hop SHALL retain read permissions, tiers, Data Scope, allowlists, platform isolation and existing budgets. Cross-source, native-bound, non-PostgreSQL, parent/via and over-budget requests SHALL be refused. Selected-row filters and sum restrictions remain unchanged.

#### Scenario: All connected floors appear before selecting a store

```gherkin
Given a connected Postgres source has North with two floors, South with one floor and Empty with none
When the user explores stores followed by floors without selecting a store
Then the user sees the three linked floors with a total of three
```

#### Scenario: Selecting a store narrows its floors

```gherkin
Given a connected Postgres source has North with two floors, South with one floor and Empty with none
When the user explores floors for North
Then the user sees only North's two floors with a total of two
```

#### Scenario: Selecting an empty store shows no floors

```gherkin
Given a connected Postgres source has North with two floors, South with one floor and Empty with none
When the user explores floors for Empty
Then the user sees no floors with a total of zero
```

#### Scenario: An empty upstream search shows no floors

```gherkin
Given a connected Postgres source has North with two floors, South with one floor and Empty with none
When the user explores floors for stores matching "Missing" without selecting a store
Then the connected result has no floors with a total of zero
```

#### Scenario: A store beyond the displayed page still contributes its floors

```gherkin
Given a connected Postgres source has more than five hundred stores
When the user explores floors without selecting a store from that source
Then floors linked to stores beyond the displayed page contribute to the exact result
```
