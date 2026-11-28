# scoped-app-reads Specification

## Purpose
An app's rows reach each person only within the places the org chart gives them (their stores, sections and subcategories), with no per-person grants, the same way for its read-only copies and its own Tables.

## Requirements

### Requirement: An app's own Tables can be read within the reader's places
An app SHALL be able to declare some of its own Tables as scoped, each mapping the scope filters to its columns. A person_scope read SHALL list a scoped Table's rows only within the reader's places, by the same rule as a dataset: a place adds rows only when the Table maps every filter it names, and no place means no rows. The reader SHALL NOT need a grant on the Table.

#### Scenario: A section's answers, and no other

```gherkin
Given a review Table holds an answer at store "9001" for subcategory "000000001" and one for subcategory "000000004"
And the reader's only place is store "9001" with subcategory "000000001"
When the app's scoped read lists the review Table
Then it answers the first answer only
And the reader cannot list the Table directly
```

#### Scenario: A place the Table cannot apply adds nothing

```gherkin
Given a reader's place names a filter the scoped Table does not map
When the app's scoped read lists the Table
Then that place adds no rows
```

#### Scenario: A read narrows only by a declared key

```gherkin
Given a scoped Table declares "body" as a key
When a read filters on a column that is not a key
Then the read is refused
```

### Requirement: A validator reads its app's read-only copies whole
A validator SHALL read its app's read-only copies as the app, whatever the person saving may read of them, so a save is checked against the copy's rows. What the validator then allows remains its own check.

#### Scenario: A note is checked against a line its writer cannot read

```gherkin
Given a person may write notes but may not read the forecast lines copy
When they save a note naming a line the copy holds
Then the note is saved
When they save a note naming a line the copy does not hold
Then the save is refused, naming the line
```
