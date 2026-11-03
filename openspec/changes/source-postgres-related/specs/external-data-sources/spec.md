# External Data Sources

## ADDED Requirements

### Requirement: Explore follows linked rows within one connected Postgres source

Explore SHALL evaluate direct Reference relationship filters between Tables bound to the same Postgres Data Source record, including nested filters, over the complete filtered upstream set with exact counts and grouped counts, independent of displayed pages. Every nested hop SHALL enforce existing read authorization, Column tiers, Data Scope, source allowlists and platform isolation, within the existing depth and request-wide hop budgets.

Relationship-filter execution across different source records, between native and connected Tables, on other engines, or through parent and Sub-table traversal SHALL remain refused, as SHALL unsupported or over-budget requests. Existing selected-row literal filtering and source sum restrictions remain unchanged.

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
