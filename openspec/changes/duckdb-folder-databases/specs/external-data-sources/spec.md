# External Data Sources

## ADDED Requirements

### Requirement: A local warehouse file source can read several databases

A System Manager MAY point a DuckDB warehouse source at a folder and name the databases it reads, as a MotherDuck source does. Each named database SHALL be read from the file of that name in the folder, and only ever read.

#### Scenario: Both databases answer one query

```gherkin
Given a folder holding the warehouse files "gold" and "marts"
And a DuckDB warehouse source on that folder that reads the databases "gold" and "marts"
When a query joins a table in "gold" to a table in "marts"
Then it answers with rows from both
```

#### Scenario: A missing database file is named

```gherkin
Given a DuckDB warehouse source on that folder that reads the databases "gold" and "stock"
And the folder has no "stock" file
When the user tests the connection
Then it fails and names "stock" as missing
```
