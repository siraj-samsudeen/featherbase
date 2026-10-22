# Sign In and Accounts Delta

## ADDED Requirements

### Requirement: An account's permanent reference is never an address or a code

Every account SHALL be identified for good by a reference Featherbase assigns,
which never changes and is not the person's email address, username or
employee code, however the account came to exist. Those can change or be
reused; the reference cannot.

#### Scenario: A person created by a Google sign-in changes their address

- **WHEN** someone's account was created by their first Google sign-in and
  they later move to a new Google address
- **THEN** their account, its history and everything that refers to it are
  unchanged; only their contact address is updated

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

## MODIFIED Requirements

### Requirement: Someone who has left is refused everywhere

When a connected service reports that a person has left, Featherbase SHALL
close that way in, keeping its history. Whether the person is still employed
is judged from the HR roster's current employment records on their account,
never from their other sign-in methods: when the roster shows another current
employment, only the ended way in closes and the person keeps signing in
through the live one; when it shows none, or Featherbase has no roster
information for the person, the account is disabled, all their sessions end
and every other way in refuses them.

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

#### Scenario: Nothing known from the roster

- **WHEN** the HR system reports that a person has left, and the roster has
  never recorded an employment on their account
- **THEN** the account is disabled, exactly as if they had only one employment
