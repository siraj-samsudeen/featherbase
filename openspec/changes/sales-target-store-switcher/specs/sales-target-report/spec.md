# Sales Target Report Delta

## ADDED Requirements

### Requirement: A reader with several stores switches between them

When a reader's scope spans more than one store, the report SHALL show one store at a time and SHALL offer a store dropdown listing each of the reader's stores. The report SHALL open on the remembered store when the reader still has it, otherwise on the default store: the store with the most Sections, a tie going to the lowest store code. The server SHALL serve a requested store only when it is one of the reader's own stores and SHALL refuse any other with 403. A reader with one store SHALL see no dropdown, and a reader with an ambiguous employee code SHALL still have no store at all.

#### Scenario: A Department Manager with Sections in two stores

- **WHEN** a Department Manager whose Sections sit in store 1501 and store 1515 opens the report
- **THEN** they see the report for the store holding more of their Sections, with a dropdown offering both stores

#### Scenario: Switching stores

- **WHEN** that reader picks the other store in the dropdown
- **THEN** the report reloads for that store alone, and opens on it the next time they visit

#### Scenario: A store that is not the reader's

- **WHEN** a request names a store that is not among the reader's own
- **THEN** the server answers 403 and mints no embed session and reads no figures

#### Scenario: An administrator assigns a second store

- **WHEN** an administrator saves a Sales Target Assignment row at a second store for a reader
- **THEN** that reader's report offers both stores instead of failing

#### Scenario: A reader with one store

- **WHEN** a reader whose scope is one store opens the report
- **THEN** the report is that store's, with no dropdown

### Requirement: The identity call lists the reader's stores

`GET /api/sales_target/me` SHALL return `stores`, one entry per store the reader can open, sorted by store code, each with `plant_code`, `store_name`, `sections` and `scope_basis`, and `default_store`, the code of the default store (null when the reader has none). Its `assignment` SHALL be the default store's. It SHALL take no store parameter. A store's `store_name` SHALL be its Sales Target Assignment label when one is set, else the active snapshot's name for that store, else null.

#### Scenario: A store with no assignment label

- **WHEN** a reader's store comes only from the Store Sections maps and the active snapshot names that store
- **THEN** the store's entry carries the snapshot's store name

#### Scenario: A reader with no store

- **WHEN** a reader with no assignment and no mapped Section asks who they are
- **THEN** `stores` is empty and `default_store` is null

### Requirement: The store parameter is checked on every read

`/report` and `/embed_session` SHALL take an optional `store` query parameter. An absent or empty parameter SHALL mean the default store. A parameter given more than once, or naming a store that is not among the reader's own, SHALL be refused with 403 before any embed session is minted or any figure is read, including for a reader who has no store at all.

#### Scenario: An empty store parameter

- **WHEN** a request carries `store=` with no value
- **THEN** it is served for the reader's default store

#### Scenario: A repeated store parameter

- **WHEN** a request carries `store=1501&store=1515`
- **THEN** the server answers 403

#### Scenario: A reader with no store names one

- **WHEN** a reader whose ambiguous employee code leaves them no store names store 1501
- **THEN** the server answers 403

### Requirement: The Access Log records the store opened

Each report opening SHALL be recorded in the Access Log with the store it was limited to, as `store=<code>` in the row's `scope`, so that who viewed which store can be answered.

#### Scenario: A two-store reader opens their second store

- **WHEN** a reader opens the report for store 1515
- **THEN** the Access Log row for that opening has scope `store=1515`

### Requirement: A store that is no longer the reader's falls back with a note

When a read for the store on show is refused with 403, the page SHALL ask the identity call again. When the reader still has access but that store is no longer among theirs, the page SHALL open the default store, forget the remembered choice, and say that the store is no longer assigned to them. The no-access card SHALL be shown only when the identity call itself refuses. A store change SHALL be announced to assistive technology.

#### Scenario: An administrator removes a reader's second store

- **WHEN** a reader has store 1515 open and its assignment is removed
- **THEN** the report opens on their default store with a note that 1515 is no longer assigned to them, and no "no access" card
