# Transactional Runtime Actions

## ADDED Requirements

### Requirement: An action can email a person after it commits
A runtime action SHALL be able to queue an email to a person by Person ID, and to ask whether that person may read one row of the app's own Tables. The platform SHALL resolve the address, never handing it to the app, and SHALL queue the email only after the action's transaction commits. A failure to queue SHALL NOT undo the action.

#### Scenario: A rolled-back action queues nothing

- **WHEN** an action queues an email and its transaction then rolls back
- **THEN** no email is queued
- **WHEN** the same action is retried with the same idempotency key after it committed
- **THEN** the handler does not run again and no second email is queued

#### Scenario: A person who can't be emailed

- **WHEN** an action emails a person who is unknown, disabled, built in, merged away or has no email
- **THEN** no email is queued, the skip is logged without an address, and the action succeeds

#### Scenario: An emailed link

- **WHEN** an action's email links to the app
- **THEN** the link uses the address that opens the app, or else the Admin address, never an address that would redirect the page away
