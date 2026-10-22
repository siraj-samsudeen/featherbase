# Sign In and Accounts Delta

## ADDED Requirements

### Requirement: A moved sign-in method keeps its history

When an administrator moves a sign-in method from one person to another,
such as a store mailbox handed to the next Store Manager, Featherbase SHALL
keep a record of who held it until when, so the question can be answered
later without reading the activity log.

#### Scenario: The store mailbox changes hands

- **WHEN** an administrator moves the ATK store mailbox's Google account from
  the outgoing Store Manager to the incoming one
- **THEN** the incoming manager's next Google sign-in opens their account, the
  outgoing manager's record shows the mailbox as an address they held until
  today, and the handover is kept as history

### Requirement: An ended sign-in method never opens an account

A sign-in method that has ended — because the person left, it was moved to
someone else, or it was removed — SHALL never open the account again, and a
session opened through it ends on its next request. The ended method stays on
record, and the same provider ID can later be linked afresh.

#### Scenario: Signing in with a removed method

- **WHEN** someone signs in with an HR system ID whose link to an account was
  ended yesterday
- **THEN** they are refused like a wrong password, and the account's history
  still shows the link and when it ended

### Requirement: HR system sign-ins are recognised by the HR record

An HR system sign-in SHALL be linked to the person by the HR system's own
record number, which never changes, rather than by the employee code, which
can change or be shared between companies. A link set up before this was so
keeps working by its employee code until the roster supplies the record
number, and is listed for the administrator meanwhile.

#### Scenario: A trial user before the roster catches up

- **WHEN** the upgrade cannot yet find the HR record number for a Team
  Leader's sign-in link
- **THEN** the Team Leader signs in the next morning exactly as before, and the
  link shows as awaiting its record number until the roster supplies it

## MODIFIED Requirements

### Requirement: Someone who has left is refused everywhere

When a connected service reports that a person has left, Featherbase SHALL
close that way in, keeping its history. Whether the person is still employed
is judged from the HR roster's current employment records on their account,
never from their other sign-in methods: when the roster shows a current
employment under a different HR record, only the ended way in closes and the
person keeps signing in through the live one; when it shows none, or
Featherbase has no roster information for the person, the account is
disabled, all their sessions end and every other way in refuses them.

#### Scenario: Leaver who also has a password

- **WHEN** someone with one employment who has left signs in with their
  still-working HR system password, and later tries their Featherbase
  password
- **THEN** both are refused, and the account is disabled with its history kept

#### Scenario: An agency record ends after the person joined the company

- **WHEN** the HR system reports that the old agency record of a person has
  left, and the roster shows a current company employment on the same account
- **THEN** the old way in is closed, and the person still signs in with their
  company record the next day

#### Scenario: A new record in the same company

- **WHEN** the HR system opens a second record for a person in the same
  company, as for a rehire or an internal conversion, and later reports the
  first record as left
- **THEN** only the first record's way in closes, and the person keeps signing
  in through the second

#### Scenario: Nothing known from the roster

- **WHEN** the HR system reports that a person has left, and the roster has
  never recorded an employment on their account
- **THEN** the account is disabled, exactly as if they had only one employment

### Requirement: Test mode for sign-in through a connected service

A deployment MAY switch on test mode for sign-in through a connected service,
only through its server environment and only with an exact switch value, and
only on a development, test or staging server — staging being a hosted trial
instance that is a production server in every other respect: any other server
refuses to start with it set. While it is on, the service SHALL NOT be asked: a tester signs in as a
person by typing the employee code on that person's record, in any mix of
capitals, with no password. The code must belong to exactly one person, and
that person must have a live, unended link to the service; who may sign in is
otherwise unchanged — one enabled account, and not the Administrator or a
System Manager. The sign-in page SHALL say that test mode is on and ask for an
employee code.

Because the service is not asked, it cannot report that someone has left.
While test mode is on, a person who has left is refused only when their
account is disabled; the instance that runs test mode SHALL keep leavers'
accounts disabled. Test mode is for a trial instance and SHALL NOT be switched
on where real users sign in.

#### Scenario: Open the report as a Team Leader during a trial

- **WHEN** test mode is on and the tester types a Team Leader's employee code
  with no password
- **THEN** they are signed in as that Team Leader and the service is not
  contacted

#### Scenario: Test mode does not widen who can sign in

- **WHEN** test mode is on and the employee code belongs to no one, to a
  disabled account, to a System Manager, or to a person whose link to the
  service has ended
- **THEN** sign-in is refused exactly as it would be with the service asked

#### Scenario: A code on two records

- **WHEN** test mode is on and the typed employee code is current on two
  people's records
- **THEN** sign-in is refused, and neither person is chosen

#### Scenario: Only a development, test or staging server accepts test mode

- **WHEN** the switch is set on a server that is not configured as
  development, test or staging
- **THEN** the server does not start, and says why

#### Scenario: A hosted trial instance runs as staging

- **WHEN** a hosted trial instance is configured as staging with the switch set
- **THEN** it starts with test mode on, and it is otherwise treated as
  production: the Administrator gets no default password

#### Scenario: Anything but the exact switch value leaves it off

- **WHEN** the switch holds a value such as "1" or "true"
- **THEN** the service is asked and a password is required, as without test
  mode

#### Scenario: The page says so

- **WHEN** test mode is on and a service is connected
- **THEN** the sign-in form shows a test-mode notice, asks for an employee
  code, and has no password field
