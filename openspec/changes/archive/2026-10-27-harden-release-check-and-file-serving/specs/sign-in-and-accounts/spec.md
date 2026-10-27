## ADDED Requirements

### Requirement: A session travels only over a secure connection

On an instance reached at a secure address, the browser SHALL be told to send the user's session only over a secure connection, so it never crosses the network in the clear. A developer's own plain local address keeps signing people in as before.

#### Scenario: Signing in at a secure address

- **WHEN** the user signs in to an instance at a secure address
- **THEN** their browser sends the session only over secure connections

#### Scenario: Signing in on a local development address

- **WHEN** a developer signs in on a plain local address
- **THEN** they are signed in and stay signed in
