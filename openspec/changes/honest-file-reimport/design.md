## Context

#851's generic file-import preview counts uniquely matched rows as updates even when its existing planner finds no value changes. The planner already identifies protected corrections, but the preview counts only newly raised conflicts as kept values. The read-only HTTP/browser diagnosis and the manager-delegated UI checklist are linked from #851.

## Goals / Non-Goals

**Goals:** truthful preview and changed-only confirmation; explicit, permission-safe key suggestions; deliberate full-overlap append.

**Non-Goals:** changing save lifecycle, no-op observations, import provenance, undo, database transactions, copy engine or scheduled refresh. No history backfill or new provenance schema.

## Decisions

### Derive preview facts from the existing import planner

Use normalized, writable mapped-value comparisons in `planImport` as the source of changed-value and divergent-retention counts. A protected field that agrees with the incoming value is not a retained differing value; a protected field receiving its previous source value is retained without a new conflict. Count retained rows once even when several corrections survive.

Reject a browser-side comparison or treating new conflicts as retention: both disagree with normalization, permissions and source history. Matched rows partition into changed and unchanged; retention overlaps either group. Do not change existing real-run `updated` semantics or historical Import Log counts to pretend they measured value changes. Where displayed, label those existing counts as matched/processed rather than changed.

Reject skipping unchanged saves: the current lifecycle, updated timestamps and import-source observations are deliberately preserved. Dry-run counts describe planned mapped-value changes, not changes an automation might make during the real import.

### Analyze candidate keys on the server and activate only on acceptance

Reuse the collection import resolver's trimmed matching and ambiguity rules, with the existing row/column read checks before advertising coverage. Return only eligible mapped candidate names/coverage, never unrelated stored values. A remembered key is a labelled suggestion, not an active plan key; still revalidate its metadata and permissions. A remembered key need not match all rows, because a refreshed file can contain new rows. Value-derived candidates require full one-to-one coverage with no blank or duplicate incoming keys, including duplicates spanning chunks or grouped sheets.

Reject downloading the whole table or guessing identity from schema-unique/header names: those approaches leak or miss data and cannot establish that this file overlaps. Multiple safe candidates are offered independently, never silently ranked into an active key. Failure to analyze is not proof of no overlap: report the failure and do not bypass the click-time append safety check.

Recheck overlap and changed counts on Import using the current plan. An acknowledgement belongs only to that plan and target scope, and any relevant plan/file change invalidates it. Keep deliberate append possible after explicit acknowledgement; choosing a key instead clears append acknowledgement. No durable reservation or snapshot lock is introduced: changes between preview and commit remain subject to existing permission, concurrency and import validation.

## Risks / Trade-offs

- Extra matching work on mapped candidates → batch lookups and reuse resolution rather than run the full history planner repeatedly; bound request sizes as for existing imports.
- New derived counts can diverge across 500-row chunks → aggregate all counts in `import-run`, with whole-file duplicate gating before chunking.
- Sensitive match coverage → refuse/omit inaccessible candidates before returning a safe-match claim; test row scopes and unreadable columns through HTTP.
- Preview cannot execute automations → state that import automation still runs; preserve existing no-history warning and protected-field guard.

## Migration Plan

No schema or data migration. Add derived dry-run/report facts and update generic UI interpretation. Existing stored matched/processed counts and undo entries retain their meaning. Rollback is the code revert without data rewriting.

## Open Questions

None requiring an owner decision: the manager authorized the reversible defaults. No in-force ADR needs supersession. Existing React/Hono/Postgres boundaries and native-table import ownership remain unchanged; a new architecture diagram would add no boundary information.
