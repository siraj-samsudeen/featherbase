## ADDED Requirements

### Requirement: An action can email a person after it commits
A runtime action SHALL be able to queue an email to a person by Person ID, and to ask whether that person may read one row of the app's own Tables. The platform SHALL resolve the address, never handing it to the app, and SHALL queue the email only after the action's transaction commits, on the address that serves the app when the email links to it. A person who is unknown, disabled, built in, merged away or has no email SHALL get no mail, and the skip SHALL be logged without any address. A failure to queue SHALL NOT undo the action.

#### Scenario: A rolled-back action queues nothing

- **WHEN** an action queues an email and its transaction then rolls back
- **THEN** no email is queued
- **WHEN** the same action is retried with the same idempotency key after it committed
- **THEN** the handler does not run again and no second email is queued
