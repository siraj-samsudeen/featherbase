# Task priority

## Purpose

Let people distinguish the importance of their tasks while safely introducing a required field into an existing populated application.

## ADDED Requirements

### Requirement: Introduce optional priority

Todos MUST gain a nullable priority with values `low`, `normal` and `high`. Existing Todos MUST initially have no priority. Users MUST be able to read and change priority through the UI and API without changing the Todo's identity or title. The optional-field version MUST be a usable application revision, not merely a transient SQL statement.

#### Scenario: Add priority to existing work
- **WHEN** an existing list is upgraded and I set one Todo to `high`
- **THEN** that Todo has high priority, the others remain unset, and all identities and titles are unchanged.

### Requirement: Make priority required without losing data

A subsequent upgrade MUST replace unset priority with `normal` and enforce NOT NULL in storage, preserving explicit priorities. Afterwards, creation omitting priority MUST default to `normal`; partial updates omitting it MUST keep its saved value. Explicit null or values outside the three allowed values MUST be rejected without changes, with an explanation and retained editable input.

#### Scenario: Tighten the constraint
- **WHEN** Todos with null, `low` and `high` priorities are upgraded
- **THEN** only null becomes `normal`; IDs, titles, explicit priorities and previous deletions remain unchanged, and direct storage writes of null are rejected.
- **WHEN** I submit `urgent` or null as priority after the upgrade
- **THEN** the request fails without changing saved data, and I can correct the value.

### Requirement: Upgrade safely

Migrations MUST support fresh installation and upgrades from populated earlier versions. Repeating migrations MUST not duplicate or modify already migrated records. Failure MUST not mark unfinished work applied. Retrying after the cause is fixed MUST preserve data. Concurrent attempts MUST serialize safely or clearly refuse one attempt without corruption. An unusable required schema MUST prevent readiness.

#### Scenario: Retry an interrupted upgrade
- **WHEN** migration fails, its cause is corrected and it runs again
- **THEN** the upgrade completes with truthful migration history and no lost records.
- **WHEN** completed migrations rerun, including concurrent attempts
- **THEN** records and migration history remain consistent.
