## Why

Tasker is needed for real team work. The owner reversed the retirement direction on 28-Oct-2026 and chose to revise the existing app, retaining its useful workflows while bringing access and presentation up to current platform standards.

## What Changes

- Retain Tasker as a first-party product app and supersede the retirement plan in #563 through an append-only decision amendment.
- **BREAKING**: require explicit Tasker membership instead of granting every signed-in person access. Members share all tasks and projects; personal tasks indicate responsibility, not privacy.
- Repair missing tasks beyond the first 500 and unreadable activity authors; adopt existing Shop Floor, theme, phone and date promises.
- Preserve tasks, projects, history and private preferences through a versioned upgrade, then verify a small-team trial.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `tasker-shared-team-work`: make membership explicit while preserving collaboration across the whole team and private preferences.

## Impact

Tasker's manifest, client, permissions and release migrations; current platform extension points; Tasker integration/browser tests and design guards. Coordinate platform grants with #617. Record the reversal of ADR 0013 without rewriting its history. UI implementation requires an owner-agreed checklist and independent visual verification.

## Non-goals

No rewrite, private tasks, separate teams, new task workflows or production deployment in the planning step. Existing Inbox-processing enhancements remain separate. This proposal does not approve new UI labels or navigation.
