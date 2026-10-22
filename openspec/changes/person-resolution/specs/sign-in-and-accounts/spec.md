# Sign In and Accounts Delta

## ADDED Requirements

### Requirement: An account's permanent reference is never an address or a code

An account SHALL be identified for good by a reference that never changes
and is not the person's email address, username or employee code. Those can
change or be reused; the reference cannot.

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

## MODIFIED Requirements

### Requirement: Someone who has left is refused everywhere

When a connected service reports that a person has left, Featherbase SHALL
close that way in, keeping its history. When the person has no other live
employment linked to their account, Featherbase SHALL also disable the
account, end all their sessions and refuse every other way in. When another
employment of theirs is still live — a worker who moved from an agency to the
company and now has two HR records — only the ended one closes and the person
keeps signing in through the live one.

#### Scenario: Leaver who also has a password

- **WHEN** someone with one employment who has left signs in with their
  still-working HR system password, and later tries their Featherbase
  password
- **THEN** both are refused, and the account is disabled with its history kept

#### Scenario: An agency record ends after the person joined the company

- **WHEN** the HR system reports that the old agency record of a person who
  now has a current company record has left
- **THEN** the old way in is closed, and the person still signs in with their
  company record the next day
