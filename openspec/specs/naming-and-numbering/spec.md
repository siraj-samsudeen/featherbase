# Naming and Numbering

## Purpose

Every row needs an id the moment it's created. A Table developer chooses how
that id is produced, so it fits how the data is normally identified — a
random id, a numbered series, a name the row's own creator types in, or a
name taken from one of the row's own fields.

## Requirements

### Requirement: Choose how new rows are named

A Table developer SHALL choose how its rows are named: a random id assigned
automatically, a numbered series with a chosen prefix, a name typed in by
whoever creates the row, or a name taken from one of the row's own fields.

#### Scenario: Switch a Table to a numbered series

- **WHEN** a developer sets a Table's naming to a series with the prefix
  "INV-" and three digits
- **THEN** new rows are named INV-001, INV-002 and so on in order, and rows
  saved before the switch keep their ids

### Requirement: A series never reuses a number

Once a series has issued a number, deleting the row that used it SHALL NOT
free that number for reuse. Every later row from the same series gets the
next number after the highest one ever issued, even after the row that used
it, or the whole Table, is gone.

#### Scenario: Delete a row and add another

- **WHEN** the row named INV-005, the newest in its series, is deleted and a
  new row is added to the same series
- **THEN** the new row is named INV-006, and 005 is never reused

### Requirement: A typed-in name must be unique

If a row's name is typed in directly rather than assigned automatically,
saving it with a name that's already in use SHALL be refused rather than
overwriting the existing row.

#### Scenario: Reuse an existing name

- **WHEN** a user creates a row and types in a name already used by another
  row in that Table
- **THEN** the save is refused and the existing row is untouched

### Requirement: Rows saved at the same moment never share a number

When many rows of a numbered series are saved at the same moment, each SHALL
get its own number, with no repeats and no gaps.

#### Scenario: Fifty saves at once

- **WHEN** fifty rows of the same series are saved at the same moment
- **THEN** they are numbered 1 to 50, each number used exactly once

### Requirement: A name that comes from the row can't be left out

A row named by a name its creator types in, or by one of its own fields,
SHALL be refused when that name or field is left empty.

#### Scenario: The naming field is blank

- **WHEN** a row of a Table named after its country column is saved with no
  country
- **THEN** the save is refused and the country column is called out

### Requirement: The new-row form asks for a typed-in name

When a Table's rows are named by whoever creates them, the form for a new row SHALL ask for that name, and leaving it blank SHALL call out the name rather than only refusing the save.

#### Scenario: Add a row from the form

- **WHEN** the user opens a new row of a Table whose rows they name, types "shelf-a1" as its name and saves
- **THEN** the row is saved under the name "shelf-a1" and opens

#### Scenario: Forget the name

- **WHEN** the user fills in a new row of that Table but leaves its name blank and saves
- **THEN** nothing is saved, the name is called out as required, and what they typed stays on screen

### Requirement: New tables number their rows 1, 2, 3

A new table SHALL number its rows 1, 2, 3 and so on, with no prefix and no
leading zeros, unless its maker chooses another way of naming them. Before the
table is created, its maker sees how its rows will be numbered.

#### Scenario: The first rows of a new table are 1, 2 and 3

```gherkin
Given the user creates a table "Plant" without choosing how its rows are named
When the user adds three plants
Then the plants are numbered 1, 2 and 3
```

#### Scenario: The builder shows the numbering before the table is made

```gherkin
Given the user is building a table "Plant"
Then the builder says its rows will be numbered 1, 2, 3
```

### Requirement: Each table keeps its own count

Each table SHALL count its own rows, so two tables numbered the same way never
take numbers from each other.

#### Scenario: Two tables with the same prefix both start at 001

```gherkin
Given two tables "Store" and "Store Copy" both named by a series with the prefix "STORE-" and three digits
When the user adds a store to each
Then each store is numbered STORE-001
```

### Requirement: A number already in the table is skipped

When the next number is already the id of one of the table's rows, for example
one an import brought in, the row SHALL get the next free number instead of
being refused.

#### Scenario: An imported row already holds the next number

```gherkin
Given a table "Bin" whose rows are numbered 1, 2, 3
And the user has added bin 1 and imported a bin with the id 2
When the user adds another bin
Then it is numbered 3
```

### Requirement: A prefix plus a column names a row

A Table developer SHALL be able to name rows by fixed text followed by one of
the row's own columns, for example PLANT- followed by the plant code. A row
gets that id when it is created, whether from the form, an import or the API.
The column is required, and before the rule is saved its maker sees a sample
id.

#### Scenario: A plant is named after its plant code

```gherkin
Given a table "Plant" whose rows are named "PLANT-" followed by their plant code
When the user adds a plant with the plant code 8151
Then the plant is named PLANT-8151
```

#### Scenario: The builder shows the shape of the id

```gherkin
Given the user is building a table "Plant" with a column "Plant Code"
When the user names its rows "PLANT-" followed by the plant code
Then the builder says ids look like PLANT-‹Plant Code›
```

### Requirement: A value already naming a row is refused by its column

When rows are named after a column, with or without a prefix, a new row whose
value would give an id already in use SHALL be refused, with the column called
out, and the existing row SHALL be left untouched.

#### Scenario: Two plants with the same code

```gherkin
Given plant PLANT-8151 exists
When the user adds another plant with the plant code 8151
Then the save is refused, naming the plant code
And PLANT-8151 is unchanged
```

### Requirement: A changed naming column keeps the id and offers Rename

Changing the column a row is named after SHALL NOT change the row's id. While
the row's id differs from the id its column now gives, the row's form SHALL
say so and offer to rename it to that id.

#### Scenario: A plant's code is corrected

```gherkin
Given plant PLANT-8151 is open
When the user changes its plant code to 8159
Then the plant keeps the id PLANT-8151
And the form offers Rename to PLANT-8159
```

### Requirement: A rename moves the column a row is named after

Renaming a row named after one of its own columns SHALL change that column too, in the same save, and the column's rules SHALL judge the new value. A read-only column SHALL NOT be moved by a rename, so the rename is refused.

#### Scenario: Rename a cluster named by its code

- **WHEN** the row VLM, named after its code column, is renamed to TVM
- **THEN** its ID and its code both read TVM, and links to it follow

#### Scenario: A new ID the column refuses

- **WHEN** a row is renamed to a value its column can't hold, such as text in a number column or a value another row holds in a unique column
- **THEN** the rename is refused and the row is unchanged

#### Scenario: A prefixed ID

- **WHEN** a Table's IDs are "CL-" followed by a column, and a row is renamed to an ID without "CL-"
- **THEN** the rename is refused, saying what an ID looks like
