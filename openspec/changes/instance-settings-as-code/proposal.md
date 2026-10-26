# Proposal

## Why

An instance's dev and prod environments drifted apart twice in one week, and
nothing said so (#465). Dev's web address was never set, so every dev deploy
was refused for two days. Dev's Google sign-in method had no allowed company
domains, so a jeyarama.com account was turned away. Only the code is kept the
same everywhere. Deployment variables are set by hand per environment, and
settings stored in the database are typed in per environment. Owners need
every environment to match unless they have said otherwise. When something is
missing or broken, they need to be told without having to go looking.

## What Changes

- **Instance settings as a file.** An instance keeps its non-secret settings
  in one file in its own private repository, with a small per-environment
  section listing only the values meant to differ. Featherbase gains an
  operation that applies the file to an environment, a dry run of it, and an
  export of an environment's current settings in the same shape. The
  instance repository applies the file on merge, and on demand.
- **Managed fields are locked in Admin.** A setting the file manages is
  read-only in Admin and says where it is changed. An operator's emergency
  command-line edit is still possible, is recorded, and is flagged as
  differing from the file.
- **A declared list of every deployment variable.** Featherbase declares each
  variable it reads, whether it is a secret, and when it is required. A
  missing required variable refuses the release and the server start, and a
  missing recommended one warns. A feature the settings turn on can require
  its own secret, and applying a file refuses to turn the feature on while
  that secret is missing. The deployment guide's variable table and an
  example environment file are generated from the list.
- **Instance health.** A page for System Managers lists every health check
  with its state, why it matters and how to fix it, plus a timeline of when
  each check started failing and when it passed again. A one-line banner
  shows while anything is wrong. A scheduled check keeps the timeline current
  when nobody is looking.
- **First-run setup.** While no System Manager has an email address, the
  built-in Administrator is offered a setup screen to name one or more
  System Managers with email. It can be skipped, and the banner stays.
- **Environment comparison without secrets.** Each environment can report
  whether each declared variable is set, and a keyed fingerprint for the
  secrets that rules say must match, or must differ, across environments.
  The instance repository's workflow shows the environments side by side.
- **BREAKING (provisional interfaces only):** the app manifest no longer
  carries instance settings as install fixtures. They move to the instance
  settings file.

## Capabilities

### New Capabilities

- `instance-settings`: an instance's settings kept in a file, applied to each
  environment, locked in Admin, and checked against a declared list of
  deployment variables.
- `instance-health`: the health page, banner, state-change timeline, first-run
  System Manager setup, and the side-by-side comparison of environments.

### Modified Capabilities

None. The new capabilities add behaviour and leave existing requirements as
they are.

## Impact

- `apps/server`: a variable registry that becomes the only place
  environment variables are read; release, boot and apply checks; apply,
  dry-run and export operations with CLI commands; health checks, their
  history table and a scheduled check; a variable report with keyed
  fingerprints.
- `apps/web`: the instance health page, the banner, the first-run setup
  screen, and read-only rendering of managed fields.
- `docs/DEPLOY.md`: a generated variable table, the instance-settings flow,
  and a required deploy-failure alert per environment.
- Instance repositories (rama_dw first): a settings file, a workflow that
  applies it on merge and on demand, and removal of the System Settings
  fixture from the manifest. That plan is in rama_dw, not here.
- Related: #464 (Jobs page; its failed-run state feeds a health check), and
  the empty-recipient work that adds the "System Managers with email" helper.
