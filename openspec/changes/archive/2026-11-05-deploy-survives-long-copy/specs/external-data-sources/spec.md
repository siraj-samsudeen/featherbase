# External Data Sources


## ADDED Requirements

### Requirement: Reading a warehouse does not hold up a deploy

A copy, manual or scheduled, SHALL read the warehouse without keeping the apps busy, however long the read takes. It SHALL hold them only while it applies the rows, as one all-or-nothing step.

#### Scenario: A deploy during a slow warehouse read

- **WHEN** a deploy starts while a copy is still reading the warehouse
- **THEN** the deploy goes ahead, and the copy applies its rows afterwards

#### Scenario: The owning app is upgraded during the read

- **WHEN** the app that owns a copied Table is upgraded while the copy is reading the warehouse
- **THEN** the copy is refused with a message to try again, and no row changes

#### Scenario: The data source's settings change during the read

- **WHEN** a deploy changes the data source's settings while the copy is reading it
- **THEN** the copy is refused with a message to try again, and no row changes

### Requirement: A refresh leaves unchanged rows alone

A row whose copied values have not changed SHALL NOT be rewritten by Copy again or a scheduled refresh: its last-updated time stays, and it does not move in a list ordered by it. It runs no automations. It is still counted as unchanged in the run's report, and the run still appears in Past imports.

#### Scenario: Nothing changed in the warehouse

- **WHEN** the user copies again and the warehouse has not changed
- **THEN** the report says every row is unchanged, and no row's last-updated time moved

#### Scenario: The warehouse now agrees with a person's correction

- **WHEN** the warehouse changes to the value a person had corrected a row to, and later changes back
- **THEN** the first refresh closes any open disagreement on that value, and the second raises a new one
