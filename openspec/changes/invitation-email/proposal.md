# Proposal

## Why

When an administrator invites a person's Google address, nothing tells that
person. The administrator has to write to each person by hand to say where to
go and which address to use (#430).

## What Changes

- Inviting a Google address emails that address: who invited them, what this
  instance is (its configured name and an optional introduction), the sign-in
  page, and to sign in with Google using that address. The inviter can choose
  not to send it.
- A failed send never undoes the invite; the inviter is told it was not sent,
  and the failure is logged without the address.
- An administrator can send a pending invite's email again, at most once in
  ten minutes. Inviting the same address again sends nothing.
- The instance's own wording lives in System Settings, never in the public
  repo.

## Capabilities

### Modified Capabilities

- `sign-in-and-accounts`: adds the invitation email and sending it again.

## Impact

- New System Settings field `invitation_email_intro` (migration 0113) and a
  `invitation_sent_at` column on sign-in identities (migration 0114).
- The invite endpoint accepts `send_invitation_email` and reports
  `invitation_email`; new `POST /api/identities/:id/resend_invitation`.
- The Person form's sign-in methods panel gains the checkbox, a resend action
  and the outcome message.
- Mail goes through the shared `deliverEmail`, so it uses the SMTP transport
  once #398 lands.
