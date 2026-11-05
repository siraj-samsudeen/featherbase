# Instance settings


## MODIFIED Requirements

### Requirement: The file brings back an instance's data sources

The file SHALL be able to name an instance's data sources, by which variable
holds each connection and never the connection itself. A MotherDuck source
names the databases it reads; its token is the instance's one MotherDuck token.

#### Scenario: After a wipe

- **WHEN** an instance's database was wiped and the user applies the file
- **THEN** its data sources are back, and a table read from one can be reflected
  again
