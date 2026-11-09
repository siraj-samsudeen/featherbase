# row-retirement Specification

## Purpose
Retiring a row takes it out of use without deleting it. The row, its history and everything
linked to it stay, and the reason is recorded, so a row that must not be deleted can still stop
being offered.

## Requirements

### Requirement: Every Table that stores its own rows can retire them the same way

Retiring SHALL work the same way on every Table that stores its own rows, with no setup by the
Table's designer. Lines inside another row, Settings tables and Tables read from an outside
database SHALL NOT offer it. Nor SHALL the Permission table: a grant ends by unticking it in the
permission matrix, and retiring one is refused, saying so.

#### Scenario: A new table can retire at once

- **WHEN** a builder creates a table of plants and adds "Sample plant"
- **THEN** "Sample plant" can be retired without any change to the table

#### Scenario: A grant is not retired

- **WHEN** a System Manager tries to retire a role's read grant on plants
- **THEN** it is refused, saying to untick it in the permission matrix
- **AND** a person holding that role can still read plants

### Requirement: Retire a row with a reason

A user SHALL be able to retire a row by giving the reason it is out of use; without a reason it
is refused.

#### Scenario: A sample plant is retired

```gherkin
Given a table of plants holds "Riverside" and "Sample plant"
When the user retires "Sample plant" because "Not a real location"
Then "Sample plant" shows it is retired because "Not a real location"
```

#### Scenario: No reason, no retirement

- **WHEN** the user tries to retire "Sample plant" without giving a reason
- **THEN** it is refused and "Sample plant" stays in use

### Requirement: A retired row says who retired it, when and why

A retired row SHALL show that it is retired, who retired it, when, and the reason given.

#### Scenario: Reading the retired plant

- **WHEN** Priya retires "Sample plant" because "Not a real location" and Arun opens it
- **THEN** Arun sees it was retired by Priya, when, and "Not a real location"

### Requirement: Retired rows are not offered

Lists, pickers and the choices offered for a Reference SHALL leave retired rows out, and a
list's count SHALL count only the rows it shows. A row that already refers to a retired row
keeps it and still shows it.

#### Scenario: The list leaves the retired plant out

```gherkin
Given a table of plants holds "Riverside" and "Sample plant"
And "Sample plant" is retired because "Not a real location"
When the user opens the list of plants
Then the list shows "Riverside" and not "Sample plant"
```

#### Scenario: A picker does not offer the retired plant

- **WHEN** an order points at "Sample plant", "Sample plant" is retired, and the user picks a plant
  for a new order
- **THEN** "Riverside" is offered and "Sample plant" is not
- **AND** the first order still shows "Sample plant"

### Requirement: Show retired rows on request

A list SHALL show retired rows again when the user asks, each marked as retired.

#### Scenario: Retired plants shown again

```gherkin
Given a table of plants holds "Riverside" and "Sample plant"
And "Sample plant" is retired because "Not a real location"
When the user opens the list of plants and asks to see retired rows
Then the list shows "Riverside" and "Sample plant"
And only "Sample plant" is marked as retired
```

### Requirement: Reactivate a retired row

A user SHALL be able to reactivate a retired row, which puts it back in use: it is offered in
lists and pickers again and no longer shows as retired. Only a row in use can be retired, and
only a retired row reactivated.

#### Scenario: The plant is back in use

```gherkin
Given a table of plants holds "Riverside" and "Sample plant"
And "Sample plant" is retired because "Not a real location"
When the user reactivates "Sample plant"
Then the list of plants shows "Riverside" and "Sample plant"
```

### Requirement: Retiring and reactivating are kept in the row's history

Each retirement and reactivation SHALL be recorded in the row's history with who did it and
when, and a retirement with its reason. The history keeps them after the row is reactivated.

#### Scenario: The history tells the story

- **WHEN** Priya retires "Sample plant" because "Not a real location" and Arun later reactivates
  it
- **THEN** its history shows Priya's retirement with the reason, then Arun's reactivation

### Requirement: Retiring needs the right to delete

Retiring a row SHALL need the same right as deleting it. The platform refuses anyone else,
whatever screen or tool they use.

#### Scenario: An editor who may not delete

- **WHEN** Arun, who may edit plants but not delete them, tries to retire "Sample plant"
- **THEN** it is refused and "Sample plant" stays in use

### Requirement: Reactivating needs the right to edit

Reactivating a row SHALL need the same right as editing it.

#### Scenario: A reader who may not edit

- **WHEN** Meena, who may only read plants, tries to reactivate "Sample plant"
- **THEN** it is refused and "Sample plant" stays retired

### Requirement: Imports keep a retired row retired

An import that matches a retired row SHALL update its values and leave it retired.

#### Scenario: A plant list re-imported from the source

- **WHEN** the user imports a plant list, matched by plant code, that gives "Sample plant" a new
  city
- **THEN** "Sample plant" has the new city and is still retired

### Requirement: The import preview counts retired rows

Before an import runs, its preview SHALL say how many of the rows it matches are retired.

#### Scenario: One retired match

- **WHEN** the user previews that plant list, which matches "Riverside" and "Sample plant"
- **THEN** the preview says one matched row is retired

### Requirement: Retiring never changes who may see what

Retiring a row SHALL NOT change which rows anyone may read or edit, including the rows linked to
it.

#### Scenario: Orders of a retired plant

- **WHEN** Arun could read the orders of "Sample plant" and "Sample plant" is retired
- **THEN** Arun can still find and read those orders

### Requirement: A table's own in-use marker is left alone

Retiring a row SHALL NOT change any of the row's own values, including an in-use marker the
Table already has, such as one loaded from another system.

#### Scenario: A plant marked active by its source

- **WHEN** "Sample plant" arrives from the source marked active and the user retires it
- **THEN** it is retired and still marked active, as the source says
