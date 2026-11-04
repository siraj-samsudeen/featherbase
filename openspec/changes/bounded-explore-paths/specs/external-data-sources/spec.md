# External Data Sources

## MODIFIED Requirements

### Requirement: Explore follows linked rows within one connected Postgres source

The user SHALL explore direct References in either direction within one Postgres data source over all matching upstream records, with exact totals and groups and the same access restrictions at every step. Up to four nested relationship levels and sixteen relationship predicates per request SHALL be permitted; other sources, indirect links and requests exceeding either bound SHALL remain refused. Selecting records and summing values remain unchanged.

The synthetic connected journey uses the same explicitly owned References and exact worker result as the native five-stage journey. It contains 121 floor sections and junctions, duplicate paths to Amber, and an unlinked control worker. A reader allowed to read Worker but not Assignment is refused even when an assignment is explicitly selected.

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

#### Scenario: Workers beyond the first page remain reachable

```gherkin
Given synthetic connected sections lead through floor sections and assignment sections to assignments and workers
When the user follows the five-stage connected journey beyond the displayed upstream rows
Then every reachable worker is counted once
And an unreadable intermediate stage cannot reveal workers
```
