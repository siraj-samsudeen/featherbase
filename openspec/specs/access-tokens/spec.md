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

### Requirement: Service accounts for automation

A System Manager SHALL be able to create a service account: a principal with
roles but no password, that never signs in and authenticates only by token.
A System Manager issues its tokens on its behalf.

#### Scenario: A service account can't sign in

- **WHEN** someone tries to sign in as a service account with a password
- **THEN** they are refused, the same as for any account with no working
  password

### Requirement: Who sees which tokens

A user SHALL see and manage only their own tokens. A System Manager SHALL
additionally see and manage everyone's tokens and every service account.

#### Scenario: An ordinary user's view is their own

- **WHEN** a user who isn't a System Manager opens their access tokens
- **THEN** they see only tokens they issued, not anyone else's
