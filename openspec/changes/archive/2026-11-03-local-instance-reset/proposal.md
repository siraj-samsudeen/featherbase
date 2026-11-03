## Why

Developers need a repeatable clean install without manually dropping databases or risking another instance's uploads (#768).

## What Changes

- Isolate local command uploads by database identity before adding reset (Siraj approved option B through #770 on 02-Nov-2026).
- Add a confirmed, local-development-only reset with a descriptive dry-run, stored-environment check and connected-process refusal.
- Preserve legacy shared uploads and refuse ambiguous storage ownership; never install implicitly.
- Document clean starts on Windows, macOS and Linux.

## Capabilities

### New Capabilities

### Modified Capabilities

- `running-an-instance`: isolated local uploads and deliberate selected-instance reset.

## Impact

Local CLI environment selection, upload resolution, CLI tests and README. No hosted-storage migration, production operation or new dependency.
