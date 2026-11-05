## Why

A scheduled copy refresh commits its rows and then queues a conflict notice for the System Managers. When the mail queue refuses that notice, the refresh must not retry (#840), but the notice was lost: a later refresh never reports the same conflicts again, so nobody heard about them (#934).

## What Changes

- When the conflict notice cannot be queued, the refresh queues a separate notice job instead, and its result says the notice will be tried again.
- The notice job tries every 15 minutes for a day, then fails, so the existing failed-job alert and Background Jobs page show it.
- The copy itself is never re-run.

## Capabilities

### Modified Capabilities

- `background-and-scheduled-jobs`: a refresh's conflict notice outlives a mail outage.

## Impact

`apps/server/src/copy-refresh.ts`; test in `apps/server/test/copy-refresh.test.ts`.
