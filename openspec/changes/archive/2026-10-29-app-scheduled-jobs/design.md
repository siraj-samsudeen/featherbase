# Design

## Owner decisions (Siraj, 29-Oct-2026)

These were settled before the work started and are recorded, not reopened:

1. The app manifest gets a `jobs` key. Each entry has a name, a default cadence
   from the platform's existing cadence choices, and a description.
2. The app's server module exports the handlers. The platform registers each
   one under an app-prefixed name, `<app>.<job>` (for example
   `feather_dash.disable_leavers`).
3. A job runs as a system actor holding only the grants the app declares for
   it. Today the one write a job needs is "disable a Person", so that is a
   declared grant, in the declared style the manifest already uses.
4. Jobs follow the app's lifecycle: created on install and enable, stopped on
   disable, removed on uninstall; an upgrade adds, changes or removes them as
   the new manifest says, reusing the existing scheduler wiring.
5. The instance settings file can set a Scheduled Job's `cadence` as well as
   `enabled`, and a file-managed cadence is locked in Admin like other
   file-managed fields.
6. Purpose: client-specific jobs leave the platform. The first is the StyleHR
   leaver check, which moves into Feather Dash in a later change; this change
   only makes sure the mechanism can host it.

## The manifest

```json
"jobs": [
  {
    "name": "disable_leavers",
    "cadence": "daily",
    "description": "Disable everyone the HR record shows has left.",
    "grants": ["read_people", "disable_people", "email_system_managers"],
    "identifiers": ["stylehr-employee-code"],
    "datasets": ["employee_exits"]
  }
]
```

and in the server module:

```js
export const jobs = { async disable_leavers(ctx) { /* ... */ } }
```

`grants` is a closed list (`read_people`, `disable_people`,
`email_system_managers`). `identifiers` names the identifier systems whose
values `read_people` hands the job (only a system that is on and not secret,
as for a scope provider), and needs `read_people`. `datasets` names the app's
own declared datasets the job reads; a job has no places, so it reads every
row. `needs` names optional secrets, as for reads and actions. The handlers
must match the declared names exactly, as for actions and reads.

## How the grants work

- The job's actor is its registered name. It is not a person or service
  account and is never handed to `runAsSystemActor` for the job as a whole, so
  it holds no role (`getRoles` answers `All` only).
- The handler gets a context with three capabilities. Each checks the job's
  own grants first; an undeclared one writes an `app_access_denied` row to the
  Access Log under the job's actor and ends the run as a final failure: not
  retried, alerted to the System Managers like any failed run, and the
  schedule carries on.
- `people.disable` is a normal row save of the Person's `enabled` flag, under
  a row lock, refusing an already disabled, missing or privileged person. Only
  for that one save does the actor hold System Manager (the instance-settings
  pattern in `system-actor.ts`), so the version history and Activity Log name
  the job as the one who disabled them.
- `people.disable` takes the Person row lock first and checks the Administrator
  and System Manager roles in a separate statement under it, so a promotion
  that commits while the disable waits is seen (Codex round 2).
- A dataset the job does not declare is refused like an undeclared grant:
  recorded in the Access Log, final, and the run fails even if the handler
  catches the error. A refusal carries only the platform's words (a grant's
  name, or "the dataset it asked for"), never what the app passed, which may
  hold a secret (Codex round 4).
- `email.systemManagers` reads the subject and body once, at the call, and
  checks and sends only that copy, so the app cannot swap a secret in while
  the recipients are looked up (Codex round 2). It refuses a message holding
  one of the app's secrets,
  queues one email per System Manager with an address, and records an
  undelivered notice when there is none.
- An app's secrets stay in (Codex round 1): a run's result or refusal reason
  holding one is replaced by the withheld message before it reaches the run
  record, the schedule or the refusal alert; a disable reason holding one is
  refused before anything is written.
- An undeclared capability stays a final failure even when the app has
  secrets: the platform keeps its own refusal message and re-raises it after
  redaction, and a handler that catches the refusal and carries on still
  fails, so nothing the job was allowed to do repeats on a retry.
- The app is trusted code with no sandbox (ADR 0011): the grants bound what the
  platform hands the job, not what Node lets its module do.

## Lifecycle, as built

- **Install**: names are claimed first: a Scheduled Job row with the same name
  that Featherbase or another app holds, or a handler someone else registered,
  refuses the install, which then leaves nothing behind. Rows are written
  after the install's ledger row, recording the owning app on each.
- **Restart and enable**: ownership is checked before any handler is
  registered. A job whose row someone else now holds is skipped and logged;
  the app's other jobs load. Admin cannot delete an app's job row: it goes
  with the app, or when an upgrade drops it. A job's method is fixed once the
  row exists, and Admin cannot add a row under an installed app's name. Each
  run also checks that its schedule row is the app's own before the app's
  code runs, so a row forced past the save path runs nothing (Codex round 3).
- **Disable** (interpretation of decision 4): the rows stay and keep their
  on/off switch, which belongs to the administrator or the settings file; the
  app's handlers are withdrawn and its queue entries removed, and a row whose
  app is off, waiting for activation, or not loaded is never queued and never
  re-queued. Flipping the rows' own switch instead would have lost an
  administrator's choice and drifted from a settings file that manages it.
- **Enable**: re-creates any missing row and queues the app's jobs again.
- **Upgrade**: the preview lists `add`, `change` and `remove` steps for jobs. A
  kept job may lose grants, identifier systems, datasets or optional secrets
  but never gain one (refused,
  like a widened table grant, #437); a new job arrives with the grants its
  version declares. A changed default cadence or description reaches a row
  only where the row still holds the old default and the settings file does
  not manage that field. The jobs wait for activation like the rest of the app.
- **Uninstall**: removes every row the app owns, by the owner recorded on the
  row, and their pending runs; a row of the same name someone else holds, and
  its queued runs, stay. An upgrade that drops a job withdraws its queued runs
  only when the app owns that schedule. Runtime apps still cannot be removed through
  the API ("Use disable"); the internal removal path does this.

## Settings file

`Scheduled Job` now manages `cadence` as well as `enabled`. The cadence is a
Choice column, so a made-up one is refused by the save and listed with the
file's other problems; the generic managed-field lock (#465 D5) makes it
read-only in Admin with no Admin code change.

## Left for the leaver-check move

- The leaver check also reads the StyleHR sign-in subject, which `read_people`
  does not hand out; the move should either record it as an identifier or add
  that to `read_people`.
- An app job's row starts switched on. The platform leaver check ships off; the
  move should decide whether a job can declare that it starts off, or rely on
  the settings file switching it off before the app is installed.
