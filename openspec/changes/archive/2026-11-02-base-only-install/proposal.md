## Why

A new user following the quick start gets a client report instead of a clean
Featherbase installation. Start with the platform alone, then let its
administrator inspect and choose apps deliberately. Issue: #758; related: #617.

## What Changes

- **BREAKING:** Running the default development command without an instance
  starts Featherbase alone, rather than refusing and directing the user to a
  client instance. The public quick start follows this path on every OS.
- Default boot does not build or install client, example or test packages.
  Named client instances and explicit app paths remain opt-in.
- Name the platform destination **Featherbase**, not Featherbase Admin.
- Add a System Manager Apps page showing available and installed apps,
  their declared additions, permissions, configuration needs and install state.
- Install only after an explicit administrator action. After installation,
  edit instance settings and role mappings through the existing generic forms;
  retain file-managed locks and keep secret values out of the browser.
- Leave installed apps and their data intact when starting an existing database.
- Provide a clear setup/start/health CLI surface, backed by the existing startup,
  preflight and health implementations rather than a second set of checks.
- Replace the first-run warning-count greeting with a resumable setup guide.
  Distinguish optional next steps and unfinished setup from operational faults;
  do not hide actual failures behind onboarding.

## Capabilities

### New Capabilities

- `app-management`: Inspect server-available apps and their configuration, choose
  one to install, and reach its instance setup afterwards.

### Modified Capabilities

- `running-an-instance`: Add a platform-only default alongside explicitly named instances.
- `trusted-runtime-packages`: Name the host destination Featherbase without
  changing app isolation, authorization or upgrade behavior.
- `instance-health`: Separate first-time setup guidance from operational faults,
  and expand first-run setup beyond inviting administrators.

## Impact

`tools/dev.mjs`, `tools/dev.test.mjs`, `init.sh`, `.env.example`, `README.md`,
the quick-start CI job, privileged app metadata in `apps/server/src/index.ts`
and `apps.ts`/`runtime-packages.ts`, and a metadata-driven Apps page linked from
the existing Admin navigation and page registry. The canonical destination
label lives in `packages/shared/src/app-routes.ts`.

No public marketplace, URL-based code downloading, package editing, uninstall,
app-contract redesign from #617, or deployment change. Consistent navigation
inside installed apps is independently owned by the navigation task thread.

Owner decision, 01-Nov-2026: list all available apps, including client apps, but
install none automatically. Test fixtures are not user apps and stay out of
automatic repository discovery. An operator still controls which trusted
packages are deployed; no public marketplace or unreviewed download is implied.

Owner chose the Apps list-and-details layout on 01-Nov-2026. CLI and first-run
guidance are in scope following the owner's follow-up. The proposed welcome UI
is a resumable checklist, not a forced wizard. CLI help must make sense before
setup and serve people and agents through the same command tree.
