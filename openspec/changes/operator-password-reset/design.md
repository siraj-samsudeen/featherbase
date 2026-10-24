# Design

## Ending sessions

Sessions are signed tokens with no stored row, and the existing ways a session ends (person disabled, sign-in method turned off, password removed, linked identity ended) cannot express "same person, new password". The person record gains the moment their sessions were last ended; a session issued before it is refused. Both sides are compared in whole seconds, because a session's issue time is whole seconds: a sign-in in the same second after the reset is kept, and an older session from that same second would also survive.

## Earlier reset links

The reset deletes every outstanding emailed link for the person in the same transaction as the new password. The emailed reset consumes its link in its own transaction before writing (burn-on-use), so a link consumed just before the shell reset could still write just after it. Its write therefore re-checks, under the person's row lock that the shell reset's write also takes, that no shell reset happened after the link was issued.

## Audit

The Activity Log's person field is the actor, and a target belongs in the operation text. The entry is recorded with actor `cli` and operation `password_set for <person>`, after the transaction commits.

## Access tokens

Tokens are a separate, named and individually revocable credential. A password reset leaves them alone; the command output and the runbook point to listing and revoking them.
