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
surrounding spaces. An ID with no linked account is refused exactly like a
wrong password, and its password is never sent to the service; if more than
one account is linked, the sign-in is refused rather than picking one.

#### Scenario: No account linked yet

- **WHEN** a user types an ID that no account is linked to
- **THEN** they get the same refusal as a wrong password, and the service is
  never asked whether their password is right

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

### Requirement: Only a clear yes signs anyone in

A connected service SHALL sign a user in only when its answer clearly says the
password is right; an empty, unreadable or unfamiliar answer SHALL be treated
as the service not answering, never as a sign-in.

#### Scenario: The service answers with a page it does not normally send

- **WHEN** the service answers a sign-in with an empty reply or a web page
- **THEN** the user is told the service is not responding and is not signed in

### Requirement: People who have left are refused

A sign-in SHALL be refused when the service's answer shows the person has left
the organisation, even if their password is right.

#### Scenario: Former employee

- **WHEN** someone who has left types their still-working HR password
- **THEN** they are told the account is no longer active and are not signed in

### Requirement: Administrators use their own password

The Administrator and System Managers SHALL never be signed in through a
connected service, so whoever runs that service cannot reach them by resetting
a password there.

#### Scenario: A System Manager has a linked ID

- **WHEN** an ID linked to a System Manager is typed with its HR password
- **THEN** the sign-in is refused like a wrong password
