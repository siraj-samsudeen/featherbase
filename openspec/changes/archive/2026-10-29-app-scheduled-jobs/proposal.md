# Proposal

## Why

Only Featherbase itself can schedule work today, so a job that belongs to one
client, such as the StyleHR leaver check, has to live in the platform. Letting
an app bring its own scheduled jobs moves that work into the client's app,
where it belongs (issue #700, decided by Siraj on 29-Oct-2026).

## What Changes

- An app lists its scheduled jobs: each has a name, how often it runs by
  default, a description, and what it is allowed to do. The app's own code
  carries the work.
- Each job appears on the scheduled jobs page under the app's name, as soon as
  the app is installed. It runs as itself and may do only what it lists:
  today, see the instance's people, disable a person, and email the System
  Managers. Anything it did not list is refused and recorded.
- A job follows its app: turning the app off stops its jobs, turning it on
  starts them again, an upgrade adds, changes or removes them as the new
  version says, and removing the app removes them. An upgrade cannot give a
  job something it was not allowed before.
- A job name belongs to one owner: an app cannot take the name of one of
  Featherbase's jobs or another app's.
- The instance's settings file can set how often a scheduled job runs, not
  only whether it runs. Admin then shows that cadence as set in the file.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `trusted-runtime-packages`: an app can bring scheduled jobs that run with
  only the access they declare.
- `instance-settings`: the settings file can set how often a scheduled job
  runs.

## Impact

Server: the app manifest's `jobs`, the app's server module's `jobs` export,
`app-jobs.ts`, the job registry and the app lifecycle; one new column on the
Scheduled Job storage (migration 0004; the baseline stays frozen). The StyleHR leaver
check stays in the platform; moving it into the Feather Dash app is a later
change.
