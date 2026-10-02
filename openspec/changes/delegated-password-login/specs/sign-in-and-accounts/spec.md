# Sign In and Accounts Delta

## ADDED Requirements

### Requirement: Sign in through a connected service

When an administrator has connected an outside sign-in service, such as the
organisation's HR system, the sign-in page SHALL offer a second way in, named
after that service. The person types their ID in that service and its
password; Featherbase asks that service to check them and never keeps, logs
or shows the password.

#### Scenario: Sign in with an HR system ID

- **WHEN** the HR system is connected, the user's account is linked to their
  HR system ID, and they sign in with that ID and their HR system password
- **THEN** they are signed in and land where a password sign-in would take
  them

#### Scenario: Wrong password at the service

- **WHEN** the service says the password is wrong
- **THEN** the user is refused with the same message as a wrong Featherbase
  password, and is not signed in

### Requirement: One linked account per service ID

A sign-in through a connected service SHALL only ever sign in the single
account whose stored service ID matches the one typed, ignoring case and
surrounding spaces. If the password is right but no account is linked, the
user is told so; if more than one account is linked, the sign-in is refused
rather than picking one.

#### Scenario: No account linked yet

- **WHEN** the service accepts the user's ID and password but no account is
  linked to that ID
- **THEN** the user is told that no account is linked to that ID, and is not
  signed in

#### Scenario: The same ID on two accounts

- **WHEN** two accounts carry the same service ID and its owner signs in
- **THEN** the sign-in is refused and neither account is signed in

### Requirement: An outage is not a wrong password

When the connected service does not answer, answers with its own failure, or
takes too long, the user SHALL be told the service is unavailable — never that
their password is wrong.

#### Scenario: The service is down

- **WHEN** the user signs in through the service while it is not answering
- **THEN** they are told the service is unavailable and to try again later

### Requirement: Off until connected

Until an administrator gives the service's address, the sign-in page SHALL
show no second way in, and attempts to use it SHALL be answered as if it does
not exist, without contacting any outside service.

#### Scenario: Nothing connected

- **WHEN** no service is connected and someone tries to sign in through it
- **THEN** the attempt is answered as not found and no outside service is
  contacted

## MODIFIED Requirements

### Requirement: Who may sign in

Only a human account an administrator has enabled SHALL be able to sign in
interactively, whether by password, by Google or through a connected service.
A disabled account, and an automation account created for scripts, SHALL be
refused every way.

#### Scenario: A disabled account can't sign in

- **WHEN** a disabled account's owner tries to sign in, by password, by
  Google or through a connected service
- **THEN** they are refused
