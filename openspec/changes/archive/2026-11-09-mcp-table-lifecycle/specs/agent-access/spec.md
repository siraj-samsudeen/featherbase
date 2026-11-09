# Agent Access

## ADDED Requirements

### Requirement: Shape a Table through an agent

Where the user may build Tables, the agent SHALL be able to add, rename, change and remove a
Table's columns under the same rules as the user building it in Featherbase. Where the user may
not, nothing SHALL change and the agent SHALL be told why.

#### Scenario: A region for every customer

```gherkin
Given the user may build Tables
When the agent adds a "region" column to "Customer"
Then every customer has a region, empty for now
```

#### Scenario: A city cannot become a number

```gherkin
Given the user may build Tables
When the agent changes the city column of "Customer" to hold numbers
Then the city column still holds text, with every customer's city
And the agent is told the city's type cannot change
```

#### Scenario: Shaping a Table needs the right to build Tables

```gherkin
Given the user may change customers but may not build Tables
When the agent adds a "region" column to "Customer"
Then "Customer" has no region column
And the agent is told building Tables needs the System Manager role
```

### Requirement: Make a Table for a file

The agent SHALL be able to ask which Table would hold a file: a column for each heading, with the
kind of value its cells hold. Where the user may build Tables, it SHALL be able to create that
Table, as offered or changed.

#### Scenario: Suppliers get a Table of their own

```gherkin
Given the user may build Tables
And a file of suppliers headed "Supplier", "Phone" and "Since", with dates under "Since"
When the agent asks which Table would hold the file and creates the "Supplier" Table it is offered
Then "Supplier" has a supplier, a phone and a since column
And the since column holds dates
```

### Requirement: Check a file before importing it

The agent SHALL be able to check a file of rows against a Table and be told how many rows would be
added or updated, and which rows would be refused and why, by their row number in the file.
Checking SHALL change nothing.

#### Scenario: A bad row is named

```gherkin
Given a file of three customers whose second has the type "Online"
When the agent checks the file against "Customer"
Then it is told two rows are ready and row 3 of the file is refused for its type
And no customer has been added
```

### Requirement: Import a checked file

The agent SHALL be able to import a file into a Table it may add rows to, exactly as it checked
it. Each heading goes into the column of that name or label, or the column the agent names. A file
or its options changed since the check SHALL be refused until it is checked again.

#### Scenario: The checked file is imported

```gherkin
Given the agent has checked a file of three customers and all three are ready
When the agent imports the file
Then the three customers are added
And each is marked as added through an agent
```

#### Scenario: A heading named differently goes where the agent says

```gherkin
Given a file of customers whose cities are headed "Town"
When the agent checks and imports the file, saying "Town" is the city
Then each new customer is in the town the file gives
```

#### Scenario: A file changed after its check is refused

```gherkin
Given the agent has checked a file of three customers
When the agent imports the file with a fourth customer added to it
Then no customer is added
And the agent is told to check the file first
```

### Requirement: Update the rows a file matches

When the agent names a column to match on, a row of the file that matches an existing row by it
SHALL update that row instead of adding another, as importing does in Featherbase.

#### Scenario: Acme Traders moves to Salem

```gherkin
When the agent imports a file with "Acme Traders" in Salem, matched on the customer's name
Then "Acme Traders" is in Salem
And there is still only one "Acme Traders"
```

### Requirement: Importing rows already there again is deliberate

When the agent names no column to match on and every row of the file is already in the Table,
the import SHALL add nothing unless the agent says to add them again, and SHALL tell the agent
which column the rows match on.

#### Scenario: The same customers imported twice

```gherkin
Given the agent has imported "Dhan Agencies" and "Elan Exports"
When the agent imports the same file again without matching on a column
Then no customer is added
And the agent is told every row is already there by the customer's name
```

### Requirement: A large update through an agent is confirmed

An import that would change more than 20 existing rows SHALL run only when the agent confirms
that number, as a person importing in Featherbase types it.

#### Scenario: Twenty-one changed cities wait for the count

```gherkin
Given "Customer" holds 21 customers in Chennai
When the agent imports a file moving all 21 to Salem, matched on the customer's name, without confirming the count
Then every customer is still in Chennai
And the agent is told to confirm 21 changed rows
```

### Requirement: Undo an import through an agent

The agent SHALL be able to list a Table's imports and undo one, under the same rules as undoing it
in Featherbase: rows it added are deleted, rows it changed get their earlier values back.

#### Scenario: Undoing the agent's import

```gherkin
Given the agent has imported a file that added "Dhan Agencies" and moved "Acme Traders" to Salem
When the agent undoes that import, found in the list of imports into "Customer"
Then there is no "Dhan Agencies"
And "Acme Traders" is in Chennai again
```

## MODIFIED Requirements

### Requirement: The agent's app knows which actions change data

Each action SHALL tell the agent's app whether it only reads, adds, or changes or deletes what is
there, so the app can run reads freely and ask the user before a change or a deletion.

#### Scenario: Deleting is flagged for approval

```gherkin
When the agent's app lists what the agent can do
Then finding and opening rows are marked as reading only
And changing and deleting a row are marked as altering existing data
```

#### Scenario: Removing a column and importing are flagged for approval

```gherkin
When the agent's app lists what the agent can do
Then checking a file is marked as reading only
And removing a column, importing a file and undoing an import are marked as altering existing data
```
