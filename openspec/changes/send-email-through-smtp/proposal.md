# Proposal

## Why

A hosted Featherbase cannot send email today: every message, including a
password reset link, lands in the local mailbox that only a developer can
read. The organisation chose the Google Workspace SMTP relay so resets and
notices reach people (#395).

## What Changes

- Send outbound email through an SMTP server when one is configured; keep the
  local mailbox when none is, so development and the tests are unchanged.
- Require an encrypted connection to the relay; never send its password in
  the clear.
- Record every failed send without anyone's address or the message, and keep
  the password-reset answer the same whether or not the send worked.
- Add a command an operator runs to send one test message.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `notifications-email-and-webhooks`: adds that email really reaches people
  once a mail server is configured, and that a failed send is recorded.

## Impact

Server email delivery, password reset, the developer command line and the
deployment guide change. Adds the `nodemailer` dependency (and `smtp-server`
for tests).
