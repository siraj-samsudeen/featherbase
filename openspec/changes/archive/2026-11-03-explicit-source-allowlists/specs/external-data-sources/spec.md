# External Data Sources

## ADDED Requirements

### Requirement: Incomplete table restrictions explain how to qualify a name

Saving a data source SHALL refuse an SQL table restriction that lacks its namespace, giving correction guidance on the restriction field: schema and table for Postgres, database and table for MySQL, catalog, schema and table for DuckDB warehouses. CSV folders SHALL continue to accept exact relative filenames without a namespace; a default namespace SHALL NOT fill in an incomplete restriction.

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
  | mysql    | shop      | stores            | database.table       |
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
  | mysql      | shop.stores           |
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

### Requirement: Stored incomplete restrictions never gain implied access

An existing incomplete restriction SHALL remain unchanged and SHALL NOT gain access through a default namespace; a refusal SHALL explain how to correct it. An exact allowed entry in the same stored restriction SHALL continue to work.

#### Scenario: A stored bare name remains refused with correction guidance

```gherkin
Given a Postgres source already stores the restriction "stores" for its public stores table
When the user tries to connect the public stores table
Then connection is refused with guidance to use "schema.table"
And its stored restriction is still "stores"
```

#### Scenario: A qualified entry still works beside an old incomplete entry

```gherkin
Given a Postgres source already stores the restriction "stores,public.stores" for its public stores table
When the user tries to connect the public stores table
Then the public stores table connects
And its stored restriction is still "stores,public.stores"
```
