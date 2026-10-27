# Notifications, Email and Webhooks Delta

## ADDED Requirements

### Requirement: Email reaches people's real inboxes

Once an administrator connects the organisation's mail server, every email
Featherbase sends SHALL go to the recipient's real inbox, over an encrypted
connection. Until then, email stays in a local mailbox for testing.

#### Scenario: A password reset reaches the inbox

- **WHEN** the mail server is connected and the user asks to reset their
  password
- **THEN** the reset link arrives in their own inbox

### Requirement: A failed email is recorded, not lost

When the mail server refuses or cannot be reached, Featherbase SHALL record
the failure for the administrator without the recipient's address or the
message itself. A password reset still answers the same way, so nobody can
use it to find out which accounts exist.

#### Scenario: The mail server is down during a password reset

- **WHEN** the mail server cannot be reached and the user asks to reset their
  password
- **THEN** they see the usual confirmation, and the administrator finds the
  failed send in the server's log
