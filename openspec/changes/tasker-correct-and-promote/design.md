## Context

Task detail already edits description but not title. A draft currently uses the latest fetched timestamp, so a background refresh can unintentionally turn a stale draft into an accepted overwrite. Freeze the row version when editing begins.

## Decisions

- Existing row PATCH contract performs task/project correction. Explicit Save/Cancel retains the original version for optimistic concurrency and preserves drafts after errors.
- Use react-markdown with raw HTML disabled and its default safe URL transform. No raw HTML plugins or hand-built HTML renderer.
- Package v2 adds nullable Text project description, through the generic package migration contract owned by the runtime-upgrades worker.
- Promotion is one declared host-transaction action, never a sequence of client requests. The integrated host owns locking, permissions, the transaction and durable result replay. Creation-only history does not make a task rich; recorded updates, comments, assignment, urgency or non-default state do. References also retain the source identity.
- Both the generic runtime DELETE route and action helper enforce source revision plus Comment/Version/declared Reference retention. Tasker additionally refuses deletion of assigned, urgent or non-default-state work and explains Cancelled. The client never performs its own read/check/delete sequence.
- Pending action envelopes persist per caller/task in session storage, retaining the same key and payload after transport failure and reload. A known refusal clears the envelope. A successful simple promotion can therefore be recovered even after its source has disappeared.

## Dependencies and evidence

The combined branch integrates platform convergence, upgrades and actions with migrations 0094 → 0095 → 0096. Tasker adds no core migration or endpoint. Version 2.0.0 declares its project description migration and sends its build-pinned package version on requests. Preserved v1 → actual packaged v2 and clean v2 are both exercised.

Remaining retention boundary: the integrated host counts Comment, Version and declared Reference columns, not arbitrary File/share soft pointers. Parent coordination must resolve that gap before claiming all references protected. Independent exploration and exact Dev deployment remain parent-owned; this change stays open until its acceptance gate is complete.

## Five-axis spec review

Requirements are governed by the owner's live-test directive. Host transaction and package migration availability are dependencies, not assertions that they already exist. Save conflicts, malicious markup, empty values, cancellation and rich/simple decision cells have observable outcomes. Specs identify absent proof explicitly; validation is not execution evidence. Refuted: creation activity alone does not require retaining the task. Verified divergence: ordinary-row deletion does not enforce a stale version and leaves soft-linked activity; recommended generic guard, not a client race.
