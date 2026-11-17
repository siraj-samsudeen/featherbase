## Why

A person an administrator creates with an email and no password has no way in when Google sign-in doesn't fit them, as for an organisation on Microsoft 365. "Forgot password" mails only accounts that already have a password (#137), and nothing lets an administrator give someone a first password (#1257).

## What Changes

- A System Manager can send a **password invite** from a Person's sign-in panel, to a person who has no way to sign in yet. It emails a one-time "Set your password" link that works for 72 hours. Opening it sets the person's first password and signs them in.
- An invite is offered only when the person has no password, no linked or pending sign-in and no expected Google sign-in, so an account that signs in another way is never given a password by an invite. "Forgot password" is unchanged.
- Sending again voids the older link. A changed email, a shell password reset, or the person gaining another way in, being disabled or having their sessions ended makes an unused link stop working.
- The Person's sign-in panel shows the invite: when it was emailed, when it expires, and when it was accepted.

## Capabilities

### New Capabilities

### Modified Capabilities

- `sign-in-and-accounts`: an administrator invites a person to set their first password.

## Impact

- Server: a new internal table and its migration (with an email-change trigger), the send and accept code, a System Manager route and a public accept route; the shell reset voids invites.
- Web: the invite in the Person's sign-in panel and a public "Set your password" page.
