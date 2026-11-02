## Context

Draft for owner review; no implementation approval is implied.

Issue #758 covers the base installation and first-time setup. A separate task
thread owns consistent navigation inside apps. ADRs 0011, 0013 and 0014 keep
platform, app and instance separate; ADR 0015 supersedes only the earlier ADR
editing and schema rules. Nothing here changes package trust or isolation.

Observed on unmodified main with a fresh database and no app paths:
`/api/apps` reports zero installed apps. `/api/instance-health` reports one
error, `settings-applied`. There is no base settings file to apply. The
existing first-run screen invites System Managers only, and its offer is tied
to a failing email health check. Development explicitly passes that check.
The CLI has `boot-check`, but no user-facing setup or runtime-health command.

## Goals / Non-Goals

**Goals:** platform-only startup; inspect all available apps, including client
apps; install explicitly; guide a newcomer through setup; expose one CLI
surface for setup, start and health.

**Non-Goals:** marketplace, downloading unreviewed code, editing package
manifests, changing permission rules, deleting existing apps, a production
deployment wizard or broad app-shell redesign.

## Decisions

### Discovering a package does not install it

Repository discovery lists product and client app manifests, excluding test
fixtures, without importing server modules or building clients. Build the
chosen package before registering/installing it, using existing package build
and lifecycle code. A deployed server offers only trusted artifacts the
operator has supplied. Explicit app paths remain supported.

Rejected: build and load every repository package at default startup. That
would keep a fresh platform install coupled to client tooling, and execute
app code before the administrator chooses it. This creates a distinction
between repository source available to prepare and runtime artifacts ready to
install; the UI must say which state an app is in. The prepare action must be
restricted to discovered trusted repository entries, not accept arbitrary paths
or commands from the browser.

### Configuration edits the instance, not the package

Display declarations from the validated manifest in plain words, plus optional
read-only technical details. Use existing metadata-generated forms for App
Setting and App Role Binding after installation, with existing managed-value
locks. Inspect setting requirements before installing. Secrets remain host
variables; show names and presence only, never values. Do not return internal
`loadAppSetup().secrets` to the UI.

Rejected: editable raw manifest or package-specific configuration forms.
Changing a manifest changes artifact identity and installation effects;
instance values already have their own transactional, upgrade-safe ownership.

### Setup guidance and operational faults are different

Use one server-owned classification for UI and CLI: setup needed, optional
next step, or operational fault. Derive progress from existing configuration,
not a parallel completion flag. A resumable welcome checklist is independent
of whether the System Manager email check passes in development.

The proposed default greeting says Featherbase is ready to explore and offers
personal administrator setup, optional apps and optional shared-instance
readiness. No apps, no warehouse, no outbound email on a local trial, and no
managed settings file by choice are not faults. If the operator explicitly
chooses file-managed configuration, a failed apply remains actionable. Failed
jobs and unsafe hosted passwords remain faults and retain a visible banner.

Rejected: suppress every health warning during onboarding, or silently apply
an empty settings file to make the check green. Both would conceal what the
user needs to know and conflate configuration policy with a successful boot.

### One CLI surface reuses existing operations

Proposed repository commands: `pnpm featherbase setup`, `pnpm featherbase start`
and `pnpm featherbase health`. Setup prepares a platform-only local instance,
prints what exists and the next action, and is safe to repeat. Start runs it;
health reports setup guidance separately from operational failures and returns
a failing exit status for actual faults or missing required setup for the
intended environment. `health --json` provides stable check identifiers, states
and next actions without terminal decoration or secrets.

After the checkout's `pnpm install`, `pnpm featherbase` shows friendly help
without initializing a database or importing database-dependent server code.
Its first section has only setup, start and health, each with a one-line purpose
and example. Advanced operations remain available through grouped help rather
than the current flat pipe-separated list of every command. Each subcommand
has `--help`; unknown commands fail without mutations and point to help.
Do not make `featherbase` an acronym or call the executable `cli` in user-facing
instructions. The pnpm prefix is the checkout's launcher, not part of the name.
No global npm install or unpublished `npx` command is promised. Non-interactive
usage must not hang on a prompt; health is read-only, setup is repeatable,
installation always names an explicit app, and all mutations report the target
instance before acting. Avoid a separate agent-only command tree.

`pnpm dev` remains the repository development script, not a second documented
newcomer workflow. Named instances remain explicit advanced opt-ins. The new
entry delegates to existing operations; do not duplicate the lifecycle or
rename every internal operator command in this change.

Rejected: several unrelated scripts with different readiness rules, or
pretending an unpublished global `featherbase` binary is already available.
The existing CLI remains the source of server operations and checks.

## Risks / Trade-offs

- Source app preparation can run trusted build code → show that fact and
  require an explicit action, only for server-discovered repository packages.
- New classification could hide a real error → prove a failed scheduled job
  remains visible during first-run setup and fails CLI health.
- File-managed and UI-managed configuration differ → report the chosen mode,
  retain locks, and never clear a prior apply record or change managed values.
- App contracts contain broader grants today → display them accurately and
  visibly, without pretending #617 enforcement has shipped.
- Cross-app naming overlaps the navigation thread → that thread updates the
  existing host-shell requirement; this change owns the canonical label.

## Migration Plan

Change only defaults for new installations. Never uninstall apps or remove
their tables on restart. Existing named-instance setup and settings application
continue unchanged. Preserve health history and classify checks at presentation;
do not rewrite past failures. Review whether classification needs a small
persisted configuration-mode choice before implementation; do not infer an
intended managed file solely from a missing apply record.

Rollback restores startup and UI code; no destructive data migration is planned.

## Open Questions

Owner chose the Apps list-and-details layout on 01-Nov-2026. Proposed welcome
direction: resumable checklist (recommended), rather than a forced linear
wizard. Owner can review the mockups on return. CLI names are proposed,
not yet approved. The distinction between source-available and install-ready
packages must be visible without forcing newcomers to understand build tools.

No currently in-force ADR needs supersession. The install screen implements
the existing app/instance boundary rather than introducing a new trust model.
