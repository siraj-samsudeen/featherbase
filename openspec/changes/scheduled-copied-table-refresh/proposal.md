## Why

Copied warehouse data otherwise stays stale until an administrator remembers to refresh it. #840 makes that work automatic and visible using the existing job controls.

## What Changes

- Let a System Manager schedule a copied Table and manage its cadence through Scheduled Job.
- Refresh through the shared copy engine, preserving corrections, conflict handling and undo.
- Record useful counts even for a no-change run, notify responsible administrators of new conflicts, and withdraw schedules when their copy or source is removed.
- Scheduled failures leave the target untouched; ordinary manual imports retain their established best-effort behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `background-and-scheduled-jobs`: scheduled copied-table refresh, source-observation attribution, outcomes and lifecycle.

## Impact

Stacked on published #772 PR805 at fccf95b514b2b7f86cbe2e5e2c7c876ad89b5dc3, not on an assumption that main contains copying. Scheduler-owned modules, actions, linkage migration and copied-table schedule controls will be added here. #772 owns the copy/import engine, shared locking and atomic option; its final published head must be reconciled before landing. No hosted datasets or accounts are changed.
