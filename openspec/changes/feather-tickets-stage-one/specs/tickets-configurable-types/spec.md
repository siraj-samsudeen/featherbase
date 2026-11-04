# Tickets configurable types

## ADDED Requirements

### Requirement: An instance configures ticket types without a release
A System Manager SHALL be able to add a ticket type, add or remove its fields (type, label, choices, required) and set its states, as Tickets configuration rows. The entry form and the ticket page SHALL render whatever the instance configured, and a new ticket SHALL be checked against its type's current fields.

#### Scenario: A configured Data Quality Issue type is used at once

- **GIVEN** a System Manager adds the type "Data Quality Issue" with a required choice field "Urgency" (Now, Later)
- **WHEN** a requester submits a Data Quality Issue without an urgency, then with "Later"
- **THEN** the first is refused as missing a required field and the second is accepted in the type's first state

#### Scenario: A removed field is no longer asked for

- **GIVEN** the Data Quality Issue type has a required "Field" field
- **WHEN** the System Manager deletes that field
- **THEN** a new Data Quality Issue is accepted without it

### Requirement: Configured types keep the app's safety guarantees
A configured type's entered values SHALL stay private to the requester and support, its state changes SHALL be recorded in append-only history, and only support SHALL move it between its configured states. Configuration SHALL never weaken the access type's verification, approval or scope-invalidation gates.

#### Scenario: A colleague sees only the summary of a configured ticket

- **GIVEN** Anjali submitted a Data Quality Issue with a current and expected value
- **WHEN** another requester opens it
- **THEN** its summary and public progress are shown and its entered values are not

#### Scenario: Support moves a ticket through its configured states

- **GIVEN** a Data Quality Issue in "Open"
- **WHEN** support sets it to "Fixed in source", which is a done state
- **THEN** history records the change, it leaves the open queue, and reopening returns it to "Reopened"

### Requirement: A configured type can route to a default assignee
A type MAY name a link field and an instance owners Table. A new ticket SHALL then be assigned to the primary owner recorded for the linked value, read as the requester; with no readable primary owner it SHALL stay unassigned.

#### Scenario: The primary owner of a source system is the default assignee

- **GIVEN** the System Owner Table lists Bala as primary owner of SAP
- **WHEN** a requester submits a Data Quality Issue for SAP
- **THEN** the ticket is assigned to Bala
