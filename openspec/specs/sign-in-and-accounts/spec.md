# Sign In and Accounts

## Purpose

A person gets into Featherbase with an email or username and a password, or
with their Google account, and stays signed in without repeating that on
every visit.

## Requirements

### Requirement: Sign in with a password

Signing in SHALL check an email or username against a password, and SHALL
refuse with the same generic message whether the account doesn't exist, the
password is wrong, or the account can't sign in this way — so a failed
attempt never reveals which of those it was.

#### Scenario: Wrong password

- **WHEN** a user signs in with an account that exists but the wrong password
- **THEN** they are refused with a generic invalid-credentials message

### Requirement: Sign in with Google

Featherbase SHALL let a user sign in with their Google account. An account
that already exists always signs in this way; a person signing in for the
first time only gets an account made for them if their email's domain is
one an administrator has allowed.

#### Scenario: First-time sign-in from an allowed domain

- **WHEN** someone with no Featherbase account signs in with Google using an
  email from an allowed domain
- **THEN** an account is created for them and they are signed in

#### Scenario: Domain not allowed

- **WHEN** someone with no Featherbase account signs in with Google using an
  email from a domain that isn't allowed
- **THEN** they are refused and told to contact IT

### Requirement: Return to where they were headed

Signing in from a link to a specific page SHALL land the user back on that
exact page, not just the general landing page.

#### Scenario: Sign in from a deep link

- **WHEN** a signed-out user follows a link to a specific record and then
  signs in
- **THEN** they land on that record, not on the general landing page

### Requirement: Stay signed in

Once signed in, a user SHALL stay signed in across visits for as long as the
session length an administrator has set, without re-entering credentials
each time.

#### Scenario: Return within the session length

- **WHEN** a signed-in user closes and reopens the browser before their
  session length has passed
- **THEN** they are still signed in

### Requirement: Reset a forgotten password

Requesting a password reset SHALL always give the same confirmation, whether
or not the account exists, and SHALL email a reset link only when it does.
The link works once and stops working after an hour or after it's used,
whichever comes first.

#### Scenario: Request a reset

- **WHEN** a user asks to reset the password for an email that has no
  account
- **THEN** they see the same confirmation as someone whose account does
  exist, and no email is sent

#### Scenario: Reuse a spent link

- **WHEN** a user follows a reset link a second time after already setting a
  new password with it
- **THEN** the second attempt is refused

### Requirement: Sign out

Signing out SHALL end the session immediately, even if the session was
already invalid or expired.

#### Scenario: Sign out ends access

- **WHEN** a signed-in user signs out and then tries to go back
- **THEN** they are asked to sign in again

### Requirement: Who may sign in

Only a human account an administrator has enabled SHALL be able to sign in
interactively, by password or by Google. A disabled account, and an
automation account created for scripts, SHALL both be refused either way.

#### Scenario: A disabled account can't sign in

- **WHEN** a disabled account's owner tries to sign in, by password or by
  Google
- **THEN** they are refused
