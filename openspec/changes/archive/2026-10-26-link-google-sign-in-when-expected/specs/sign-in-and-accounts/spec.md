# Sign In and Accounts Delta

## ADDED Requirements

### Requirement: Link a first Google sign-in to a person who expects it

An administrator who manages the system SHALL be able to mark a person as
expecting Google sign-in. That person's first Google sign-in SHALL link to
them only when Google has verified the address, it is the person's own
address on a domain Google sign-in admits, the person is enabled and has no
Google sign-in yet; after that the link is permanent and the mark is used up.

#### Scenario: The expected person signs in

- **WHEN** an administrator marks a person as expecting Google sign-in, and
  that person signs in with Google using their own verified work address
- **THEN** they are signed in to their own account, and the activity log
  records that the system linked their Google sign-in

#### Scenario: The same address from another Google account later

- **WHEN** a person's first Google sign-in has linked to them, and later a
  different Google account with the same address signs in
- **THEN** it is refused because the address is already in use

#### Scenario: A person who is not marked

- **WHEN** someone signs in with Google using the address of a person who is
  not marked as expecting it
- **THEN** they are refused because the address is already in use, as before

#### Scenario: Someone who does not manage the system

- **WHEN** a user who can edit people but does not manage the system tries to
  mark a person as expecting Google sign-in
- **THEN** they are refused and the person is unchanged
