## ADDED Requirements

### Requirement: An administrator invites a person to set their first password

A System Manager SHALL be able to send a password invite to a person who has
an email address and no way to sign in yet, while password sign-in is on. The
person gets an email with a link that works once and for 72 hours. Opening it
lets them choose their first password, which signs them in.

#### Normative details for the whole requirement

An invite is offered only to an enabled person with no password, no linked or
pending sign-in and no expected Google sign-in, so an account that signs in
another way is never given a password by an invite; "Forgot password" still
refuses an account with no password. Sending again replaces the earlier link.
A link stops working once it is used, when it expires, when another is sent,
when the person's email changes, when their password is reset from the
server, and when, by the time it is used, the person is disabled, has a
password or another way in, or had their sessions ended after it was sent.
The person's sign-in panel says when the invite was emailed, when it expires,
and when it was accepted.

#### Scenario: A tester from another company gets in

- **WHEN** an administrator adds Ravi, who has a Microsoft 365 address and no
  way to sign in, and sends him a password invite
- **AND** Ravi opens the link within 72 hours and chooses a password
- **THEN** he is signed in, and later signs in with his email and that
  password

#### Scenario: Not offered to someone who signs in another way

- **WHEN** an administrator tries to send a password invite to a store
  manager who signs in through the HR system
- **THEN** it is refused and the account gets no password

#### Scenario: Sending again replaces the link

- **WHEN** an administrator sends Ravi a second invite and he opens the first
  link
- **THEN** the first link is refused and the second one works

#### Scenario: A used link

- **WHEN** Ravi opens the link a second time after setting his password
- **THEN** it is refused

#### Scenario: Email changed before the link is used

- **WHEN** an administrator changes Ravi's email after sending the invite
- **THEN** the link sent to the old address no longer works
