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
