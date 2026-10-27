# Design

## Context

See proposal.md, Why. The constraints that shape the approach:

- **The release cannot see the instance's file.** Railway's `preDeployCommand`
  runs `pnpm --filter server release` in a container built from this public
  repository. The instance's file lives in its private repository
  (`JeyaramaGroup/data-warehouse`, `featherbase/`).
- **Manifest fixtures are insert-only.** `provisionFixtures` (`apps/server/src/apps.ts`)
  adopts an existing row unchanged, so uninstalling an app never removes rows
  that were there before it. That is right for install and useless for
  keeping settings the same: re-running it would have fixed neither drift.
- **The rama_dw fixture is already stale.** It sets System Settings
  `allowed_login_domains`, which migration 0100 moved onto the sign-in method
  as `allowed_email_domains`. The manifest was never installed on the
  current prod database.
- **Variables are read ad hoc.** About 27 names are read through
  `process.env`, a local `val()` in `email.ts`, and `config.ts`. The
  `docs/DEPLOY.md` table is hand-written, and only `SITE_URL` has a release
  check (`release-preflight.ts` step 2b).
- **The built-in Administrator has no email,** by design. It is the
  break-glass login, so on a fresh instance system notices reach nobody.

## Goals / Non-Goals

**Goals:**
- One reviewed file per instance decides every non-secret setting in every
  environment.
- Every variable the server reads is declared once, in code. Docs, checks and
  the example file come from that declaration.
- Problems that today appear only as release-log lines, or nowhere, are shown
  to System Managers until they are fixed, with history.

**Non-Goals:**
- Storing or setting secrets. Railway (or any host's secret store) keeps
  them, and Featherbase only checks that they are present and consistent.
- People and role membership. Those are data and stay editable in Admin.
- Building the service from the instance repository against a pinned
  framework version. rama_dw's README plans this for editing seeds. It is
  compatible with this design, and not needed for it.
- Alerting on a failed deploy from inside Featherbase. A failed release
  leaves the old code serving, which cannot report on a release it never
  ran. That alert is the host's (see Migration Plan).

## Decisions

### D1. A separate settings file with an inline overlay

`featherbase/instance-settings.json` in the instance repository, next to
`manifest.json`. It has a `settings` block keyed by Table, and an
`environments` block whose entries hold only values meant to differ.

```jsonc
{
  "settings": {
    "System Settings": { "app_name": "Feather Dash", "privacy_notice": { "file": "privacy-notice.md" } },
    "Sign-in Method": [ { "row_id": "google", "allowed_email_domains": "jeyarama.com,…" } ],
    "Scheduled Job":  [ { "row_id": "disable_leavers", "enabled": true } ]
  },
  "environments": {
    "dev": { "settings": { "Scheduled Job": [ { "row_id": "disable_leavers", "enabled": false } ] } },
    "production": {}
  }
}
```

- *Why:* install (adopt, never overwrite) and settings (make it match) need
  opposite rules. Separate files keep one rule each. The overlay inside one
  file is the list of intended differences, which #465 needs as its
  allowlist.
- *Alternatives:* inside `manifest.json` (one file, two rules), or a base file
  plus a file per environment (differences spread out, and a missing overlay
  file fails silently).

### D2. Which settings are in scope

The managed scope is declared by the framework, not by the file: System
Settings fields, sign-in method rows, the `enabled` switch of scheduled jobs,
and the privacy notice (by file reference). The file may manage any subset of
it. A field outside the scope is rejected (see D4).

- *Why:* the lock (D5) and the export (D9) both need to know the scope
  without reading the file. A framework-declared scope also keeps future
  clients from putting data, such as people, into the file.

### D3. Delivery: pushed from the instance repository

The framework exposes `POST /api/instance-settings/apply` (with `dry_run`),
plus `cli settings:apply --file` and `cli settings:export`. rama_dw's workflow
calls the endpoint per environment with a service-account token: on merge,
and on demand. Nothing runs on every deploy or on a schedule.

- *Why:* the framework stays generic, and needs no GitHub token and no
  knowledge of where the instance repository is. With the lock (D5), the
  database changes only when the file changes, so applying on merge is
  enough.
- *What covers the gaps:* a fresh or restored database (the on-demand run is
  a DEPLOY.md step, and health shows "never applied"), a renamed field
  (strict validation in D4, plus a dry run in the PR check), and a failed
  apply (a red workflow run, re-run it).
- *Alternatives:* pulling at release with a repository token (every deploy
  then depends on GitHub and one more secret), or building from the instance
  repository (much larger).

### D4. Apply runs as one transaction through the normal save path

Each declared row is saved with `saveDoc` under one transaction, as actor
`instance-settings`, with the source revision (commit SHA and workflow run,
sent by the caller) in the Activity Log. An unknown Table, row or field, a
value the field rejects, or a feature whose required secret is missing (D7)
aborts with every problem listed and nothing written. The result lists each
changed field with its old and new value. Secret fields never appear in it,
because none are in scope.

The last successful apply's revision and time are stored, which feeds the
"settings applied" health check.

### D5. Managed fields are read-only in Admin

The managed paths of the last successful apply are stored. The form renders
those fields read-only with a note naming the instance's settings file, and
the server's save refuses a change to them from any actor other than
`instance-settings` and `cli`.

- *Why:* no drift from Admin edits at all, which is what makes applying on merge
  enough (D3).
- *Break glass:* `cli settings:set` over `railway ssh` still works, is logged
  with actor `cli`, and makes the "matches the file" check fail until the
  file catches up.
- *Alternatives:* file overwrites Admin edits (quick fixes silently vanish, and
  a daily run would be needed), or edits stick and drift is flagged (two
  sources of truth).

### D6. A variable registry in code

`apps/server/src/env.ts` becomes the only module that reads `process.env`.
Each entry has `secret`, `required` (`always`, `outside-dev`, `recommended`,
`optional`, or a predicate over the instance's settings such as "a Google
sign-in method is enabled"), `purpose`, and an optional cross-environment
rule (`must-differ` or `must-match`, D10). A lint rule bans `process.env`
elsewhere. A script generates the DEPLOY.md table and `.env.example`, and CI
fails when they are out of date.

- *Why:* the only way "which variables must exist" can be checked by a
  command, and the lint rule keeps the registry complete as features are
  added.
- *Alternatives:* a hand-written `.env.example` per repository, or the list in
  the instance file. Both go stale.

### D7. Tiered checks at release, boot and apply

One function evaluates the registry against the environment and the stored
settings. Release preflight and server boot refuse on a missing required
variable (this replaces the hand-written `SITE_URL` step) and warn on a
missing recommended one. Apply refuses to turn on a feature whose secret is
missing.

Manifest sources' `url_env` names are checked while the source exists, but a
missing one **warns** at release and boot rather than refusing (amended in
#482): it makes only that source unusable, and the source's queries refuse at
the point of use, naming the variable. Refusing the whole release for it was
an unverifiable deploy risk on prod.

### D8. Health checks as small functions with recorded state changes

Each check returns `{ ok, severity, message, fix }`. The same list is printed
by the release step, served to the health page and banner, and run by a
scheduled job every 15 minutes. A `health_check_event` table records only
changes of state (check, ok or failing, message, time). A check that stays
the same writes nothing.

Initial checks: a System Manager has an email (using the shared helper from
the empty-recipient work), recommended variables present, settings applied,
managed settings match the last apply, each scheduled job's last run
(#464), and the Administrator default password (moving
`diagnoseAdminBootstrap`'s warning). Missing *required* variables are not a
check, because the server cannot be running with one.

The banner sits where `PreviewBanner` sits in `AdminLayout.tsx`, is shown
only to System Managers, takes its colour from the worst failing check, and
cannot be dismissed.

- *Why:* the banner shows current state and fixing the cause clears it, so
  there is no read state to keep in sync. Recording only changes of state
  gives a full timeline at almost no storage cost. The scheduled check is
  itself a job, so if it stops, the job check catches it.

### D9. First-run setup is triggered by the health check

The setup screen is offered to the built-in Administrator whenever the
"System Manager has an email" check fails, not on a first-run flag. It
creates each named person with the System Manager role and sends an
invitation through the existing invitation flow. When outbound email is the
sink, it shows the invitation links to copy instead. "Not now" always
reaches the Admin screen.

- *Why:* one rule covers a new instance and an old one whose last System
  Manager with an email has left. Administrator is never blocked, because it
  exists for emergencies.
- *Alternative rejected:* System Managers declared in the settings file. That
  would lock role membership behind a PR (D5).

### D10. The variable report and keyed fingerprints

`POST /api/instance-settings/variables` (System Manager token) takes a random
key per call. It returns, per registry entry, whether the variable is set,
and for entries with a cross-environment rule, a truncated
`HMAC-SHA256(key, value)`. It also says which file revision the last apply
used and whether the settings still match it. The instance repository's
workflow asks every environment with one key per run, and the platform's
`cli settings:compare` checks the reports against the rules and prints the
side-by-side table (`cli settings:variables` produces the same report from a
shell on the server). Nothing is kept.

- *Why:* catches a shared `JWT_SECRET` (dev tokens valid on prod) and a
  mismatched `GOOGLE_CLIENT_SECRET`. A new key each run means fingerprints
  cannot be collected over time or tested against guesses offline.

## Risks / Trade-offs

- [Revealing whether two environments' secrets are equal] → Only a System
  Manager token can call it, the key is per run, and only rule-bearing
  secrets are fingerprinted.
- [Locking blocks an urgent fix in Admin] → The CLI break-glass path (D5), which
  is recorded and flagged.
- [A fresh database runs unconfigured until someone triggers the apply] → A
  DEPLOY.md step, plus a red "never applied" check on the banner.
- [Moving every variable read into one module touches many files] → It is
  mechanical, and the lint rule plus typecheck prove completeness.
- [The scheduled check adds load] → The checks are a handful of cheap
  queries every 15 minutes.

## Migration Plan

1. Ship the framework parts (registry, checks, apply, dry run, export,
   health) to dev and prod. With no file applied yet, nothing is locked and
   health shows "never applied".
2. In rama_dw (its own plan): export from prod into
   `featherbase/instance-settings.json`, remove the System Settings fixture
   from `manifest.json`, and add the workflow with a dry-run PR check.
3. Decide each dev difference the dry run shows, in that PR. Default to
   prod's value, and use the `dev` overlay only for intended differences.
4. Merge. The apply runs on dev, then on prod. Prod must report "no changes".
   If it doesn't, the workflow stops before applying anywhere else.
5. Turn on Railway's deploy-failure notification for each environment, and
   record it as a DEPLOY.md checklist step.
6. Close #465 with the workflow run as evidence.

Rollback: an apply is one transaction and the previous values are in its
result and the Activity Log. Re-applying the previous file revision restores
them. Clearing the stored managed paths unlocks those fields in Admin.

## Open Questions

- How long health history is kept. It is small, so "forever" is fine to
  start with.
- The exact `must-differ` and `must-match` list beyond `JWT_SECRET`,
  `FILE_URL_SECRET` and `GOOGLE_CLIENT_SECRET`. To be set per entry when the
  registry is written.
