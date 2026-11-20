# sales-target-report

## REMOVED Requirements

### Requirement: Say when the month has no data yet

**Reason**: It spoke for the cached copy of the figures, which is retired (#1366). The Dive reads the warehouse itself.
**Migration**: None. The Dive shows what the warehouse holds for the month.

### Requirement: One report on the page

**Reason**: The cached table it folded away is retired (#1366); the Dive is the only report on the page.
**Migration**: None.

### Requirement: A missing target side is never read as ₹0 targets

**Reason**: It guarded refreshes of the cached copy, which is retired (#1366).
**Migration**: None. The Dive reads the warehouse's targets itself.

### Requirement: Say how current the figures are

**Reason**: The refresh time and cut-off belonged to the cached copy, which is retired (#1366).
**Migration**: None. The Dive says how current its own figures are.

### Requirement: A reader is never left waiting for the cache

**Reason**: There is no cache to wait for (#1366).
**Migration**: None.

### Requirement: The cache is shared but each reader sees only their own

**Reason**: The cache is retired (#1366). Each reader's Dive is still sent only their own stores and subcategories.
**Migration**: None.

### Requirement: A failed refresh keeps the last good figures

**Reason**: Nothing is refreshed into Featherbase any more (#1366).
**Migration**: None.

### Requirement: Operators can see how each refresh went

**Reason**: The cached copies and their refreshes are retired (#1366).
**Migration**: None.

### Requirement: Choose this month or last month, in the interactive report too

**Reason**: Its "last month's copy not ready" case spoke for the cached copy, which is retired (#1366). The rest is carried over unchanged as "Choose this month or last month".
**Migration**: None.

## MODIFIED Requirements

### Requirement: The report lists the reader's stores by name

Asking who the reader is SHALL list every store the reader can open, sorted by store code, each with its name, its Sections and why the reader has it, and SHALL name the default store. A store's name SHALL be its Sales Target Assignment label when one is set, else the store's own name, else none. The question SHALL NOT take a store, and the assignment it reports SHALL be the default store's.

#### Scenario: A store with no assignment label

- **WHEN** a reader's store comes only from the Store Sections maps
- **THEN** the store's entry carries the store's own name

#### Scenario: A reader with no store

- **WHEN** a reader with no assignment and no mapped Section asks who they are
- **THEN** their list of stores is empty and they have no default store

### Requirement: The Access Log records the store opened

Each report opening SHALL be recorded in the Access Log with the stores it was limited to, so that who viewed which store can be answered.

#### Scenario: A two-store reader opens their second store

- **WHEN** a reader opens the report for store 1515
- **THEN** the Access Log row for that opening names store 1515

### Requirement: Only people given the report can open it

Only people who hold the report's viewer role SHALL open the report or see anything about their own scope. The role SHALL be checked on every request, so taking it away stops the reader's very next request, and a person without it SHALL be told plainly that they have no access, with no figure shown.

#### Scenario: A signed-in person without the role

- **WHEN** a signed-in person who does not hold the viewer role opens the report
- **THEN** they see a plain "no access" message and no figures

#### Scenario: The role is taken away mid-session

- **WHEN** an administrator removes the role from a reader who has the report open, and the reader's page makes its next request
- **THEN** that request is refused and the page shows the "no access" message

### Requirement: The live report fails honestly

When the live report can't be opened, because the instance has no live report set up or the live report service is unreachable or refuses, the page SHALL say in one plain sentence that the report couldn't load and offer to try again, without technical detail. The live report's credentials SHALL never be sent to the browser.

#### Scenario: No live report on this instance

- **WHEN** the instance has no live report set up
- **THEN** the page says the report couldn't load, and shows no figures of its own

#### Scenario: The live report service is down

- **WHEN** the live report service cannot be reached
- **THEN** the page says the report couldn't load right now, and trying again reopens the report without reloading the page

## ADDED Requirements

### Requirement: Choose this month or last month

The report SHALL let the reader choose this month, from the first through today in India Standard Time, or last month, from its first day through its last. This month SHALL be the default. The choice SHALL be kept in the page's address, and SHALL keep meaning "this month" or "last month" as the calendar moves on. No earlier month SHALL be offered.

#### Scenario: Last month's result early in the next month

- **WHEN** a reader opens the report on 2 November and chooses last month
- **THEN** they see October's targets and sales for 1 to 31 October, limited to their own subcategories as this month's are

#### Scenario: Last month in the interactive report

- **WHEN** a reader chooses last month and the interactive report is set up
- **THEN** the interactive report opens on last month's dates, ending on its last day
