# Access Tokens

## Purpose

Scripts and integrations authenticate with a personal access token instead
of a password, and automation that isn't tied to a real person authenticates
as a service account instead.

## Requirements

### Requirement: Issue an access token

A user SHALL be able to issue a labeled access token for themselves, with an
expiry they choose or none at all. Its secret is shown once, at the moment
it's issued, and never again afterward.

#### Scenario: Issue and lose it

- **WHEN** a user issues a token, closes the confirmation without copying
  it, and comes back to look for the secret later
- **THEN** the secret is nowhere to be found; only issuing a new token gets
  them a usable one

### Requirement: A token acts as its owner

A token SHALL authenticate as the person or service account that owns it,
with that owner's roles — it carries no scope of its own narrower than what
its owner can already do.

#### Scenario: A token can do what its owner can do

- **WHEN** a token's owner holds a role that can delete rows on a table
- **THEN** a request authenticated with that token can delete those rows too

### Requirement: Revoke a token

Revoking a token SHALL stop it from authenticating immediately and can't be
undone; the token stays listed afterward, marked revoked, rather than
disappearing.

#### Scenario: A revoked token stops working

- **WHEN** a token is revoked and then used on a request
- **THEN** the request is refused

### Requirement: An expired token or a disabled owner also stops it

A token SHALL stop authenticating once it passes its expiry, or once its
owner is disabled — the same as if it had been revoked, without anyone
having to revoke it by hand.

#### Scenario: Disabling an owner dead-ends their tokens

- **WHEN** a service account that owns several tokens is disabled
- **THEN** none of its tokens can authenticate any more, without revoking
  each one individually

#### Scenario: Turning the owner back on revives its tokens

- **WHEN** that service account is enabled again
- **THEN** each of its tokens that was not revoked or expired works again,
  with no new token needed

### Requirement: A token never travels in a web address

A token SHALL authenticate only when it is sent alongside the request, the
standard way for scripts. A token placed in a web address SHALL be refused,
so it never lands in browser history or server logs.

#### Scenario: A token in a link is refused

- **WHEN** a script puts its token in the address of a private file instead
  of the header
- **THEN** the request is refused, while the same token sent the standard way
  opens the file

### Requirement: The token list shows whether each token still works

Each listed token SHALL show its label, when it was created and last used,
when it expires, and whether it still works: active, revoked, expired, or
stopped because its owner is disabled. A token SHALL stay revocable until it
is revoked, even after it has expired or its owner was disabled.

#### Scenario: A disabled owner's token does not read as active

- **WHEN** a System Manager opens the tokens after disabling a service
  account that holds an unrevoked token
- **THEN** that token shows as stopped by its disabled owner, not as active,
  and can still be revoked

### Requirement: Service accounts for automation

A System Manager SHALL be able to create a service account: an automation
account with roles but no password, that never signs in and authenticates
only by token. It is its own kind of account, not a person: it keeps its
tokens, roles, data access and shared rows exactly as a person would, and a
token issued to it behaves like a token issued to a person. A System Manager
issues its tokens on its behalf.

#### Scenario: A service account can't sign in

- **WHEN** someone tries to sign in as a service account with a password
- **THEN** they are refused, the same as for any account with no working
  password

#### Scenario: A service account's data access applies everywhere

- **WHEN** a service account limited to one store's rows reads a list, opens
  a row, runs a report, searches, exports or listens for live updates
- **THEN** it sees only that store's rows on every one of those paths

#### Scenario: A service account keeps what it has

- **WHEN** the instance is upgraded so that automation accounts are kept apart
  from people
- **THEN** every service account still has its tokens, its roles and the data
  access and shared rows it had, and its scripts keep working without a new
  token

### Requirement: A service account has a unique short name

A service account SHALL be named with a short lowercase name of letters,
digits, dashes and underscores, and no two service accounts SHALL share a
name, whatever its letter case.

#### Scenario: A name already taken

- **WHEN** a System Manager creates a service account named the same as an
  existing one, in capitals
- **THEN** it is refused, and the existing account is unchanged

### Requirement: A service account is switched off, not deleted

A service account SHALL be retired by disabling it; it cannot be deleted,
and its tokens keep working until it is disabled or they are revoked.

#### Scenario: Deleting a service account that holds a token

- **WHEN** a System Manager tries to delete a service account that holds a
  token
- **THEN** it is refused, and the token still authenticates

### Requirement: Changes to a service account are recorded

Creating a service account, disabling or enabling it, and changing its roles
SHALL each be recorded in the activity record with who did it.

#### Scenario: Giving a service account a role

- **WHEN** a System Manager gives a service account the System Manager role
- **THEN** the activity record shows that System Manager changed that
  account's roles, and to what

### Requirement: Who sees which tokens

A user SHALL see and manage only their own tokens. A System Manager SHALL
additionally see and manage everyone's tokens and every service account.

#### Scenario: An ordinary user's view is their own

- **WHEN** a user who isn't a System Manager opens their access tokens
- **THEN** they see only tokens they issued, not anyone else's
