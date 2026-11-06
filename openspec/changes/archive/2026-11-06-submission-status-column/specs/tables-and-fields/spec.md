## ADDED Requirements

### Requirement: A column can be called status

A Table SHALL be able to hold its own column called `status`, whose values mean nothing to the platform. Whether a row is a draft, submitted or cancelled SHALL be held only in `submission_status`, a name no Table's own column can take.

#### Scenario: A status that reads like the lifecycle

- **WHEN** a row's own `status` column holds `cancelled`
- **THEN** the row can still be edited and deleted

#### Scenario: Submitting leaves the column alone

- **WHEN** a row with its own `status` column is submitted, or moved by a workflow
- **THEN** its `submission_status` changes and its `status` stays as it was

#### Scenario: The lifecycle's name is reserved

- **WHEN** a builder adds a column called `submission_status`
- **THEN** the column is refused

### Requirement: An SLA reads a Table's own status when no workflow decides

With no active workflow on a Table, a Service Level Agreement's fulfilled states SHALL be matched against the Table's own `status` column, when it has one.

#### Scenario: A resolved row past its deadline

- **WHEN** a row past its deadline has `status` set to one of the agreement's fulfilled states
- **THEN** the row is not marked overdue
