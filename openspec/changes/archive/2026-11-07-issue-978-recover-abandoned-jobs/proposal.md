## Why

A server stopped while a job runs (a deploy replacing it, a crash) leaves that job's row `running` for good. Nothing claims a `running` row again, and the schedule check counts it as the schedule's one live entry, so a scheduled job stops silently (#978).

## What Changes

- Claiming a job gives it a lease (5 minutes) that its worker renews every minute while the handler runs.
- Any worker treats a `running` row whose lease has run out as abandoned: the lost attempt is logged as a failed attempt ("The server stopped while this job was running"), and the job is queued again, or failed once its attempts are spent. A scheduled job's next run is then queued and the System Managers are told, as for any run that has failed for good.
- A row from before leases counts as abandoned an hour after it was claimed.
- Old and new servers overlap during a deploy; a live run keeps its lease fresh, so it is not run twice.

## Capabilities

### Modified Capabilities

- `background-and-scheduled-jobs`: a job left running by a stopped server is picked up again.

## Impact

- Migration 0154 adds `background_job.lease_expires_at` and its read-only column.
