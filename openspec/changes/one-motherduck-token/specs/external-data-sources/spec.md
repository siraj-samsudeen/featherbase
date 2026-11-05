## MODIFIED Requirements

### Requirement: Connect a data source

A builder with System Manager authority SHALL be able to register a data
source — a Postgres or MySQL database, a DuckDB file, or a folder of CSV
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

### Requirement: Choose which databases a warehouse source reads

The System Manager SHALL choose which databases the source reads, from the
account's own databases and those shared with it, and at least one must be
chosen. Only the chosen databases are offered for browsing.

#### Scenario: Only the two ticked databases appear

```gherkin
Given the instance's token can read five databases, among them "sales" and "stock"
When the user ticks "sales" and "stock" and saves the source
Then browsing the source offers "sales" and "stock" and no other database
```

#### Scenario: Saving stays blocked until a database is ticked

```gherkin
Given the instance's token can read databases
When the user has ticked no database
Then the source cannot be saved
```

## ADDED Requirements

### Requirement: Connect a MotherDuck warehouse with the instance's token

MotherDuck is a cloud warehouse. A token, a long secret string, signs in to
it and decides which databases can be read. An instance has one MotherDuck
token, set when it is deployed, and everything in Featherbase uses it. A System
Manager SHALL be able to connect a MotherDuck warehouse without handling the
token. They SHALL be told who the token signs in as and how many databases it
can read, or be given a plain reason why it cannot be used.

#### Scenario: The token's owner and databases show

```gherkin
Given the user is a System Manager
And the instance's token can read five databases
When the user starts connecting a MotherDuck warehouse
Then they are told who the token signs in as and that it can read five databases
And they are not asked for a token
```

#### Scenario: A refused token is explained, not echoed

```gherkin
Given the user is a System Manager
And MotherDuck refuses the instance's token
When the user starts connecting a MotherDuck warehouse
Then they are told the token was refused, in plain words
And the message does not contain the token
```

#### Scenario: An instance with no token says so

```gherkin
Given the user is a System Manager
And the instance has no MotherDuck token
When the user starts connecting a MotherDuck warehouse
Then they are told the instance has no MotherDuck token
And no database is offered
```

### Requirement: A MotherDuck warehouse is only ever read

Featherbase SHALL only read a MotherDuck warehouse, with no setting that could
change this, even when the instance's token has write rights.

#### Scenario: A token with write rights still cannot change the warehouse

```gherkin
Given the instance's token can also write to the warehouse
And a table connected from its database "sales"
When the user tries to change a row of that table
Then the change is refused
And the row in the warehouse is unchanged
```

## REMOVED Requirements

### Requirement: Connect a MotherDuck warehouse by pasting its token

**Reason**: No token is pasted; the instance has one token.
**Migration**: Set the instance's deployment variable. A source already connected keeps its chosen databases.

### Requirement: A pasted token stays secret

**Reason**: No token is pasted or stored any more.
**Migration**: The instance's token is a deployment variable, which is never shown, returned or logged.

### Requirement: A warehouse token can be replaced

**Reason**: There is one token for the instance, set where it is deployed.
**Migration**: Change the instance's deployment variable and restart it.
