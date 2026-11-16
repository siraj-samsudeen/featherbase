# External Data Sources

## MODIFIED Requirements

### Requirement: Connect a data source

A builder with System Manager authority SHALL be able to register a data
source — a Postgres database, a DuckDB file, or a folder of CSV
files — naming where its connection details are kept rather than typing them
in. A MotherDuck warehouse uses the instance's one MotherDuck token. Those
details are never stored in the open, shown back, or written to a log. Only a
System Manager can register or manage a data source.

#### Scenario: Connect and check it

- **WHEN** a builder registers a Postgres data source and asks Featherbase to
  test it
- **THEN** Featherbase connects and reports whether it succeeded, without
  ever displaying the connection details

#### Scenario: A folder or warehouse that can't be reached

- **WHEN** a builder tests a data source whose folder or warehouse file is
  missing
- **THEN** the test reports that it failed and says why, and the data source
  shows that its last check failed

### Requirement: Incomplete table restrictions explain how to qualify a name

Saving a data source SHALL refuse an SQL table restriction that lacks its namespace, giving correction guidance on the restriction field: schema and table for Postgres, catalog, schema and table for DuckDB warehouses. CSV folders SHALL continue to accept exact relative filenames without a namespace; a default namespace SHALL NOT fill in an incomplete restriction.

#### Scenario Outline: An incomplete restriction is refused before it is saved

```gherkin
Given the user manages a "<engine>" source with default namespace "<default>"
When the user saves its table restriction as "<entry>"
Then saving is refused with restriction-field guidance to use "<format>"
And the source is not registered

Examples:
  | engine   | default   | entry             | format               |
  | postgres | public    | stores            | schema.table         |
  | postgres |           | stores            | schema.table         |
  | duckdb   | gold.main | stores            | catalog.schema.table |
  | duckdb   | gold      | main.stores       | catalog.schema.table |
  | postgres | public    | public.ok,stores  | schema.table         |
```

#### Scenario Outline: An explicit restriction saves without contacting its source

```gherkin
Given the user manages a "<engine>" source with default namespace ""
When the user saves its table restriction as "<entry>"
Then the source is registered with exactly that restriction

Examples:
  | engine     | entry                 |
  | postgres   | public.stores         |
  | duckdb     | gold.main.stores      |
  | csv-folder | stores.csv            |
  | csv-folder | finance/stores.csv    |
```

#### Scenario: A refused edit preserves the saved restriction

```gherkin
Given a Postgres source is registered with restriction "public.stores"
When the user changes its restriction to "public.stores,stores"
Then saving is refused with restriction-field guidance to use "schema.table"
And its stored restriction is still "public.stores"
```

## ADDED Requirements

### Requirement: A source on an engine Featherbase no longer supports says so

A data source saved on an engine Featherbase no longer supports SHALL be refused wherever it is used, naming the engine and saying to delete the source, rather than failing as an unknown engine. MySQL is such an engine.

#### Scenario: A MySQL source saved before support ended

```gherkin
Given a data source "legacy-shop" was saved with the engine "mysql"
When the user tests "legacy-shop"
Then the test is refused, saying MySQL is no longer a supported data source and to delete "legacy-shop"
```
