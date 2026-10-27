## ADDED Requirements

### Requirement: Each sign-in records where it came from

Every sign-in SHALL record the network address it came from, whichever way the
person signed in, so an administrator can see from where an account was used.
An address the person's browser could have made up is never recorded as theirs.

#### Scenario: See where a sign-in came from

- **WHEN** the user signs in with their password from the shop's network
- **THEN** the administrator finds the sign-in in the Activity Log with the
  shop's public address

#### Scenario: A made-up address is not believed

- **WHEN** someone signs in with a request that claims to come from another
  address
- **THEN** the Activity Log shows the address the request really came from
