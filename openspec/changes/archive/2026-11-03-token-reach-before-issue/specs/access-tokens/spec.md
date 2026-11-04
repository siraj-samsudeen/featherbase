## MODIFIED Requirements

### Requirement: Issue an access token

A user SHALL be able to issue a labeled access token for themselves, with an
expiry they choose or none at all. Choosing none SHALL take a second,
deliberate confirmation. Its secret is shown once, at the moment it's
issued, and never again afterward.

#### Scenario: Issue and lose it

- **WHEN** a user issues a token, closes the confirmation without copying
  it, and comes back to look for the secret later
- **THEN** the secret is nowhere to be found; only issuing a new token gets
  them a usable one

#### Scenario: A token that never expires is asked about first

- **WHEN** a user issues a token with no expiry
- **THEN** they are asked first, and the token is issued only when they
  confirm; choosing an expiry instead issues it straight away

## ADDED Requirements

### Requirement: Say what a token will reach before issuing it

Before a token is issued, the user SHALL see what it will reach: the Tables its
owner can read and the Tables it can change, or every Table when the owner is a
System Manager. This SHALL follow the owner's real permissions, including what
every account is granted, and the user SHALL be warned, without being stopped,
when the owner holds no role of its own or can read no Table.

#### Scenario: A new service account's token

- **WHEN** a System Manager issues a token for a service account just created
  with no role
- **THEN** the dialog lists only what every account can read, says it can
  change nothing, and warns that the account has no role of its own

#### Scenario: Given a role, the account reaches its Table

- **WHEN** the account is given a role that can read and change "Reach Dock",
  and a token is issued for it
- **THEN** the dialog lists "Reach Dock" under what it can change, and no
  warning shows
