# External Data Sources

## ADDED Requirements

### Requirement: Tables connect through a login that owns none of them

A Postgres data source whose login may read its tables but owns none of them
SHALL find the column that identifies each row, and let the user connect the
table, exactly as when the login owns the tables.

#### Scenario: Shops connect through a login that owns nothing

```gherkin
Given the user is a System Manager
And a Postgres database with a shop table whose rows are identified by their id
And a data source whose login may only read that table and owns nothing
When the user browses the data source
Then the shop table is offered for connecting
When the user connects it
Then the user sees the database's shops listed in Featherbase
```
