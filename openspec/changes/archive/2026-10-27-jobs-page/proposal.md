# Proposal

## Why

Scheduled jobs are spread across two raw lists today, and a run that fails or refuses tells nobody. A System Manager finds out only by remembering to look. The instance owner decided on 26-Oct-2026 (#464) that one Jobs page should show every scheduled job, and that a failed or refused run should email the System Managers.

## What Changes

- One Jobs page for System Managers lists every scheduled job with an on/off switch, its schedule and next run, its last run (when, OK, failed or refused, and a one-line result) and a way to run it now. The background queue, where a failed job is retried, stays on the same page below it.
- A job can end a run as refused: it declined to act, such as the leaver check on a stale feed or an oversized batch. A refused run counts as a failure but is not retried, and the schedule carries on.
- A scheduled job's run that fails for good, or refuses, emails every System Manager once, in plain words. When no System Manager has an email address, that is recorded rather than dropped.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `background-and-scheduled-jobs`: the Jobs page, refused runs, and the failure email.

## Impact

Migration 0129 adds `refused` as a run outcome and a Scheduled Job's last result. The worker records refused runs and sends the alert; the leaver check refuses through it; the instance health check treats a refused last run as failing. The Jobs page replaces the old background job monitor at the same address.
