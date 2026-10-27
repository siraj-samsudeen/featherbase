# Sign In and Accounts Delta

## ADDED Requirements

### Requirement: An account's permanent reference is never an address or a code

Every person's account SHALL be identified for good by a reference
Featherbase assigns, which never changes and is not the person's email
address, username or employee code, however the account came to exist. Those
can change or be reused; the reference cannot.

#### Scenario: A person created by a Google sign-in changes their address

- **WHEN** someone's account was created by their first Google sign-in and
  they later move to a new Google address
- **THEN** their account, its history and everything that refers to it are
  unchanged; only their contact address is updated

#### Scenario: Trial accounts get their permanent reference

- **WHEN** the trial instance is upgraded and its accounts, until now
  identified by employee codes and addresses, receive permanent references
- **THEN** every person keeps their roles, access, history and sign-in
  methods, signs in once more, and nothing in Featherbase still refers to the
  old identifiers

#### Scenario: The sign-in page says why

- **WHEN** someone whose session ended — at the upgrade, or because their
  account was disabled — opens Featherbase
- **THEN** the sign-in page tells them their session has ended and asks them
  to sign in again

#### Scenario: Names, never permanent references, on screen

- **WHEN** a person's permanent reference would appear on a screen — a
  comment's author, a list of people, a picker, a token's owner
- **THEN** their name is shown instead (or their username, address or
  employee code where they have no name), and the reference itself never is

## MODIFIED Requirements

### Requirement: Who may sign in

Only a person an administrator has enabled SHALL be able to sign in
interactively, by any of their linked sign-in methods. A disabled person
SHALL be refused every way. An automation account created for scripts is not
a person: it has no sign-in method, needs no email, and authenticates only
with its access token.

#### Scenario: A disabled account can't sign in

- **WHEN** a disabled person tries to sign in, by password, by Google or
  through a connected service
- **THEN** they are refused

#### Scenario: An automation account is not a person

- **WHEN** an administrator looks for an automation account where people are
  chosen, such as assigning a task or sharing a row with a person
- **THEN** it is not offered; it appears only in the list of automation
  accounts
