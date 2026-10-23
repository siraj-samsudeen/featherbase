# Sign In and Accounts Delta

## ADDED Requirements

### Requirement: Email an invitation to sign in

Inviting a person's Google address SHALL email that address, unless the
administrator chooses not to. The email says who invited them and what this
service is, in the organisation's own words, links to the sign-in page, and
says to sign in with Google using that address. Inviting an address that is
already invited sends nothing.

#### Scenario: A new invite is emailed

- **WHEN** an administrator invites a person's Google address
- **THEN** that address receives one email naming the administrator and the
  service, with a link to sign in with Google using that address

#### Scenario: The administrator opts out

- **WHEN** an administrator invites an address and chooses not to send an email
- **THEN** the invite is made and no email is sent

### Requirement: A failed invitation email is reported

When the invitation email cannot be sent, the invite SHALL still be made, and
the administrator SHALL be told that the email did not go out.

#### Scenario: The mail server refuses

- **WHEN** an administrator invites an address and the email cannot be sent
- **THEN** the invite is listed as pending and the administrator sees that the
  email was not sent

### Requirement: Send an invitation again

An administrator SHALL be able to send a pending invite's email again, but not
within ten minutes of the last one.

#### Scenario: Resend too soon

- **WHEN** an administrator sends an invitation again minutes after it was sent
- **THEN** no email is sent and they are told to try again later
