## Why

On 10-Nov-2026 the release that brought the roster link (#1157) switched its scheduled job on during the deploy. The previous deployment was still polling the queue, had no handler for the new job, and failed its first run three times in a second. Siraj chose to have such a worker hand the run back.

## What Changes

- A worker with no handler for a job whose Scheduled Job row is enabled puts the run back on the queue a minute later, using up no attempt, and says on the run that it is waiting for a server with the handler.
- It does this for at most 30 minutes from the first hand-back; after that the run fails as an unknown job does today, and the System Managers are told.
- A job with no Scheduled Job row, or a switched-off one, still fails at once.

## Capabilities

### Modified Capabilities

- `background-and-scheduled-jobs`: a scheduled run waits for a server that can run it.

## Impact

- `apps/server/src/jobs.ts`, migration 0158 (`background_job.handed_back_at`).
