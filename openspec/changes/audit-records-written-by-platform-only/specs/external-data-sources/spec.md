# Spec Delta

## ADDED Requirements

### Requirement: A data source never reaches the platform's own records

A data source SHALL always point at data outside the platform. Featherbase
SHALL refuse a data source that connects to its own database, however the
connection is spelled, and SHALL refuse to connect a table to the schema
where the platform keeps its own records, on any database.

#### Scenario: Pointing a data source at the platform's own database

- **WHEN** a System Manager registers a data source whose connection leads to
  the platform's own database
- **THEN** Featherbase refuses to use it, and no table connected through it
  can read or change a platform record

#### Scenario: Connecting a table to the platform's schema

- **WHEN** a System Manager connects a table to a relation in the platform's
  own schema on any data source
- **THEN** it is refused
