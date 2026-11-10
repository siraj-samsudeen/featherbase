## ADDED Requirements

### Requirement: Staff on the roster are linked before they sign in

The system SHALL give every current row of an HR system's staff roster an
account, a sign-in link and the row's employee identifiers before the person
first signs in, and mark the row as theirs, all together or not at all for each
row, and end the sign-in link of anyone whose roster rows are no longer
current. A link SHALL sign nobody in by itself.

#### Scenario: A current employee is linked before signing in

- **WHEN** the roster link runs and a current roster row has no account
- **THEN** the row gets a new account with no roles, a live sign-in link and
  its employee identifiers, nothing is emailed, and a second run changes nothing

#### Scenario: Someone who already signed in is matched

- **WHEN** the roster link runs for a row whose person already signed in
- **THEN** no account is made and their account stays as it was

#### Scenario: A linked employee still needs their password

- **WHEN** a linked employee signs in outside test mode
- **THEN** the HR system checks the password, and an answer naming a different
  record is refused as for a wrong password

#### Scenario: A case for an administrator is held

- **WHEN** a row's ID is on two roster rows, or its employee code is current on
  another account, or its account is an administrator's
- **THEN** the row is not linked and the activity log notes the row and the
  reason once

#### Scenario: A leaver's link ends

- **WHEN** a linked person's roster row is no longer current, or is retired
- **THEN** their sign-in link ends, the identifiers the roster wrote close, and
  their account is kept

#### Scenario: A run that would end too many links

- **WHEN** a run would end more than the limit of links
- **THEN** it ends none and is reported as refused, and still links new rows
