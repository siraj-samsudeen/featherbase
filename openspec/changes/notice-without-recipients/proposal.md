# Proposal

## Why

System notices, such as the leaver-check summary and the alert that someone is waiting for access, go to every enabled System Manager who has an email address. When none has one, the notice reaches nobody and nothing says so. A new instance starts with only the built-in Administrator, which has no address, so every notice is lost until someone notices the silence (#463).

## What Changes

- One shared rule decides who receives a system notice.
- A notice with nobody to receive it is recorded: an entry in the activity log by the system, one structured log line, and, for the leaver check, the run's own result and its job record say the summary reached nobody.
- Before a release, and in the boot check, a warning (never a refusal) says when no System Manager other than the built-in Administrator has an email address, so alerts would reach nobody.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sign-in-and-accounts`: a system notice that has nobody to receive it is recorded, and a release warns before that can happen.

## Impact

New `system-notice.ts` (the recipient list and the undelivered record), used by `leaver-check.ts` and `waiting-for-access.ts`. Job Execution gains a read-only `result` column (migration 0120), written through `JobContext.setResult`. `release-preflight.ts` adds the warning, which `cli boot-check` prints.
