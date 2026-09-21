## Context

Task detail already edits description but not title. A draft currently uses the latest fetched timestamp, so a background refresh can unintentionally turn a stale draft into an accepted overwrite. Freeze the row version when editing begins.

## Decisions

- Existing row PATCH contract performs task/project correction. Explicit Save/Cancel retains the original version for optimistic concurrency and preserves drafts after errors.
- Use react-markdown with raw HTML disabled and its default safe URL transform. No raw HTML plugins or hand-built HTML renderer.
- Package v2 adds nullable Text project description, through the generic package migration contract owned by the runtime-upgrades worker.
- Promotion is one declared host-transaction action, never a sequence of client requests. Generic contract integration is pending. Creation-only history does not make a task rich; any actual changed-field history, comment, assignee, urgency or non-default state does.
- Current ordinary-row delete ignores expectUpdatedAt and orphans soft references to comments/history. Do not claim safe deletion or expose unsafe read-then-delete. Recommend refusing deletion of retained history and using Cancelled. Await generic guard/owner ruling rather than silently losing context.

## Dependencies and evidence

Task correction can ship independently. Project clean-install UI can be tested before upgrades; upgrade evidence remains a gap until the generic contract is integrated. Promotion and deletion remain specified-but-unbuilt until host transaction guarantees are available. No core files belong to this change.

## Five-axis spec review

Requirements are governed by the owner's live-test directive. Host transaction and package migration availability are dependencies, not assertions that they already exist. Save conflicts, malicious markup, empty values, cancellation and rich/simple decision cells have observable outcomes. Specs identify absent proof explicitly; validation is not execution evidence. Refuted: creation activity alone does not require retaining the task. Verified divergence: ordinary-row deletion does not enforce a stale version and leaves soft-linked activity; recommended generic guard, not a client race.
