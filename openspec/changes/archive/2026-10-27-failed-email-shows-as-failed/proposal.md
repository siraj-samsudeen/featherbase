# Proposal

## Why

When the mail server refuses an email, the email is marked as failed, but its background job shows as successful: the job's retry finds nothing left to send and reports done. An administrator looking at the background jobs sees nothing wrong, and retrying the job by hand does not send the email either (#334).

## What Changes

- An email the mail server refuses for good, or that runs out of attempts, fails its background job at once, with the reason. It does not spend its remaining attempts.
- An administrator's retry of that job sends the email again, once.
- A temporary failure is still retried automatically (#395), unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `notifications-email-and-webhooks`: a failed email shows as a failed background job, and a retry by hand sends it.

## Impact

Platform layer. `send_email` job and the job runner (`email.ts`, `jobs.ts`). No migration.
