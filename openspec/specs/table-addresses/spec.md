# Table addresses

## Purpose

People can read and share Table destinations without changing the Table names, labels or row identities they know.

## Requirements

### Requirement: Readable Table destinations preserve identity

Table destinations SHALL use lowercase, hyphen-separated Table path segments. Opening, editing and saving through those destinations SHALL use the unchanged Table name, labels and access rules, not a guessed name reconstructed from the address.

#### Scenario: A spaced Table name remains unchanged

```gherkin
Given the user manages a Table named Route Probe with a row called Stock review
When the user opens Route Probe through Table navigation and edits Stock review
Then its address uses the Table segment route-probe
And the saved row belongs to Route Probe with its original labels
```

### Requirement: Table and row destinations do not collide with tools

Table destinations SHALL be separate from fixed pages, and existing-row destinations SHALL be separate from creation and Table tools. Row IDs SHALL remain unchanged, including reserved words and punctuation.

#### Scenario: A Table name does not open the builder

```gherkin
Given the user manages a Table named New Table
When the user opens New Table through Table navigation
Then its list opens separately from the Table builder
```

#### Scenario: Reserved words remain existing row IDs

```gherkin
Given the user manages a Table named Route Probe with rows identified by columns, merge, new and A / B?x#%
When the user opens each Route Probe row by its shared address
Then each existing row opens with its exact ID instead of a tool or a new-row form
```

### Requirement: Table destinations retain their context

Generated Table destinations SHALL retain filters, initial values for new rows, and view selections without changing their values. Portal, print, map and settings destinations SHALL use the same Table spelling while retaining canonical Table and row identity.

#### Scenario: Shared destinations retain the selected work

```gherkin
Given the user manages a Table named Route Probe with a row called Stock review
When the user follows filtered, new-row, print, portal and map destinations for Route Probe
Then the destinations retain their selected work and unchanged row identity
And the settings destination still opens System Settings by its real name
```

### Requirement: Ambiguous Table spellings are refused

An address whose Table spelling matches multiple names SHALL be refused rather than opening an arbitrary Table. An exact canonical Table name SHALL retain the existing resolution precedence. Existing colliding identities SHALL remain untouched, without trimming, renaming, merging or URL exceptions.

#### Scenario: An ambiguous spelling selects no Table

```gherkin
Given two existing Table definitions have the same normalized spelling
When the user opens that spelling as a Table address
Then the ambiguity is reported without opening either Table
```

### Requirement: New Table identities cannot take another Table's address

Creating or renaming a Table SHALL refuse a normalized URL spelling owned by another live Table, through direct creation, import, reflection and app installation/upgrades. Existing permission and ownership checks SHALL remain in force. A rename retaining only its own spelling SHALL remain allowed; deleted names SHALL not reserve spellings. Updating an existing Table SHALL preserve its identity.

#### Scenario: A new Table cannot take an existing Table's address

```gherkin
Given the user manages a Table named Route Probe with a row called Stock review
When the user attempts to create another Table with Route Probe's address
Then the new Table is refused without changing Route Probe
And the original Route Probe remains reachable with its unchanged identity
```

#### Scenario: Importing a new Table cannot take an existing Table's address

```gherkin
Given the user manages a Table named Route Probe with a row called Stock review
When the user imports rows into a new Table with Route Probe's address
Then the imported Table is refused without changing Route Probe
And a new Table with a different address can still be imported
```
