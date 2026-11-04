# External Data Sources

## ADDED Requirements

### Requirement: Explore can follow a connected row's outgoing links

Within one connected PostgreSQL source, Explore SHALL follow References toward their referenced rows as well as back to rows carrying the Reference. Each step MUST use the complete upstream result and the reader's access to every traversed Table and Reference; reaching a row by several paths MUST NOT duplicate it.

#### Scenario: Workers beyond the first page remain reachable

```gherkin
Given synthetic connected sections lead through floor sections and assignment sections to assignments and workers
When the user follows the five-stage connected journey beyond the displayed upstream rows
Then every reachable worker is counted once
And an unreadable intermediate stage cannot reveal workers
```
