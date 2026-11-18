## MODIFIED Requirements

### Requirement: Revoke a token

Revoking a token SHALL stop it from authenticating immediately and can't be
undone; the token stays listed afterward, marked revoked, rather than
disappearing. Revoke SHALL ask for confirmation first, naming the token and
saying that anything using it stops working at once and that this cannot be
undone (#1323).

#### Scenario: A revoked token stops working

- **WHEN** a token is revoked and then used on a request
- **THEN** the request is refused

#### Scenario: Revoke asks first

- **WHEN** a person presses Revoke on a token
- **THEN** a confirmation names the token and says it cannot be undone, and
  the token still works until they confirm

#### Scenario: Cancelling a revoke changes nothing

- **WHEN** a person cancels the confirmation, or presses Escape
- **THEN** the token stays active

### Requirement: A service account is switched off, not deleted

A service account SHALL be retired by disabling it; it cannot be deleted,
and its tokens keep working until it is disabled or they are revoked.
Disabling SHALL ask for confirmation first, saying how many of its active
tokens stop working until it is enabled again; enabling acts at once (#1323).

#### Scenario: Deleting a service account that holds a token

- **WHEN** a System Manager tries to delete a service account that holds a
  token
- **THEN** it is refused, and the token still authenticates

#### Scenario: Disable asks first

- **WHEN** a System Manager presses Disable on a service account that holds
  two active tokens
- **THEN** a confirmation says its 2 active tokens stop working until it is
  enabled again, and the account stays enabled until they confirm

#### Scenario: Enable needs no confirmation

- **WHEN** a System Manager presses Enable on a disabled service account
- **THEN** it is enabled at once
