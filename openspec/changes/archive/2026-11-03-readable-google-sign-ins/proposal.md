## Why

On a Person's Sign-in methods panel, a Google account that has been claimed leads with Google's internal
account number, a 21-digit string that means nothing to an administrator (#837). Before the first sign-in
the same row reads clearly ("invited: <address> · invitation emailed …"), so the wording gets worse once the
invite is used. What the administrator needs is the address, when and how the link was made, and when it
was last used.

## What Changes

- A linked Google account on the Person form reads as its address, then when and how it was linked (for
  example "at first sign-in", or by the administrator who linked it) and when it was last used.
- Google's account number is still there for engineers, behind "Details", and is no longer the first thing
  the row says.
- Unlink's confirmation says what it does: that Google account will no longer sign in as this person.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sign-in-and-accounts`: how an administrator reads a person's linked Google account.

## Impact

The Person form's Sign-in methods panel (web) only. The API already returns `linked_at`, `linked_by` and
`last_used_at` for each identity. No server, API, permission, schema or migration change.
