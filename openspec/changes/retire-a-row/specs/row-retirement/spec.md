# Row Retirement

## Purpose

Retiring a row takes it out of use without deleting it. The row, its history and everything
linked to it stay, and the reason is recorded, so a row that must not be deleted can still stop
being offered. Every Table that stores its own rows works the same way.

## ADDED Requirements

### Requirement: Retire a row with a reason

A user SHALL be able to retire a row by giving a reason; a row cannot be retired without one. The
row then shows that it is retired, who retired it, when, and why.

#### Scenario: A sample plant is retired

```gherkin
Given a table of plants holds "Riverside" and "Sample plant"
When the user retires "Sample plant" because "Not a real location"
Then "Sample plant" shows it is retired because "Not a real location"
```

#### Scenario: No reason, no retirement

- **WHEN** the user tries to retire "Sample plant" without giving a reason
- **THEN** it is refused and "Sample plant" stays in use

### Requirement: Retired rows are not offered

Lists, pickers and the choices offered for a Reference SHALL leave retired rows out unless the
user asks to see them. A row that already refers to a retired row keeps it and still shows it.

#### Scenario: The list leaves the retired plant out

```gherkin
Given a table of plants holds "Riverside" and "Sample plant"
And "Sample plant" is retired because "Not a real location"
When the user opens the list of plants
Then the list shows "Riverside" and not "Sample plant"
```

#### Scenario: A picker does not offer the retired plant

- **WHEN** the user picks a plant for a new order
- **THEN** "Riverside" is offered and "Sample plant" is not
- **AND** an order already pointing at "Sample plant" still shows it

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
lists and pickers again and no longer shows as retired.

#### Scenario: The plant is back in use

```gherkin
Given a table of plants holds "Riverside" and "Sample plant"
And "Sample plant" is retired because "Not a real location"
When the user reactivates "Sample plant"
Then the list of plants shows "Riverside" and "Sample plant"
```

### Requirement: Retiring and reactivating are kept in the row's history

Each retirement and reactivation SHALL be recorded in the row's history, saying who did it, when
and, for a retirement, why. It is kept even after the row is reactivated.

#### Scenario: The history tells the story

- **WHEN** the user retires "Sample plant" because "Not a real location" and later reactivates it
- **THEN** its history shows both, with who did each, when, and the reason for the retirement

### Requirement: Who may retire and reactivate

Retiring a row SHALL need the same right as deleting it, and reactivating it the same right as
editing it. The platform refuses anyone else, whatever screen or tool they use.

#### Scenario: An editor who may not delete

- **WHEN** a user who may edit plants but not delete them tries to retire "Sample plant"
- **THEN** it is refused and "Sample plant" stays in use

### Requirement: Imports keep a retired row retired

An import that matches a retired row SHALL update its values and leave it retired. Before the
import runs, its preview says how many of the matched rows are retired.

#### Scenario: A plant list re-imported from the source

- **WHEN** the user imports a plant list that includes "Sample plant", matched by its code
- **THEN** the preview says one matched row is retired
- **AND** after the import "Sample plant" has the new values and is still retired

### Requirement: Retiring changes what is offered, never who may see what

Retiring a row SHALL NOT change which rows anyone may read or edit, and SHALL NOT change the
Table's own columns, including an "active" column the Table already has.

#### Scenario: A store kept for access

- **WHEN** the store "Sample plant" is retired
- **THEN** everyone who could see that store's records before still sees them
