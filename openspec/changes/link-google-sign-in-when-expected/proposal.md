# Proposal

## Why

A Google sign-in never links to an existing person by address alone, so a
reused mailbox, or a provider that does not check addresses, cannot take over
an account. That rule stays the default. But it means an administrator who
adds someone, and knows they will sign in with Google, must also send them an
invite, or the person's first Google sign-in is refused because their address
is already in use (#473, decided by the owner on 26-Oct-2026: option C, "flag
at creation").

## What Changes

- An administrator can mark a person as expecting Google sign-in when they
  create or edit them.
- The first Google sign-in links to that person only when every condition
  holds: the mark is set; Google has verified the address; the address's
  domain is one Google sign-in admits; it is that person's own address; the
  person is enabled; and they have no Google sign-in yet.
- That link uses the mark up, so a later Google account with the same address
  cannot claim the person again. A Google sign-in linked any other way uses it
  up too. The link is recorded in the activity log as a system action.
- Only someone who manages the system can set or clear the mark; the server
  refuses anyone else, whatever the form shows.
- Every other case keeps today's answer: refused because the address is in
  use, a new person for an unknown address, or an invite claimed.

## Capabilities

### Modified Capabilities

- `sign-in-and-accounts`: adds linking a first Google sign-in to a person who
  is expected to sign in with Google.

## Impact

- New Person column `expects_google_sign_in` (migration 0120), off for
  everyone already there; guarded like a person's roles and enabled flag.
- The Person form shows it with a one-line hint.
- `cli create-person <email> --expects-google-sign-in` creates such a person
  without a password.
