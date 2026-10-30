## Context

See proposal.md and #563 for the owner decisions of 28–29-Oct-2026. The earlier plan's team-visible personal tasks are superseded. Existing Tasker uses All grants, a 500-task read cap and old visual styles. The owner chose Attention first in conversation; the carousel's last selected variant does not override that choice.

## Goals / Non-Goals

**Goals:** preserve useful workflows, enforce creator-only privacy, support team discussion and subtasks, and make recurrence predictable. Deliver all work in one PR; use incremental commits and verification internally.

**Non-goals:** a rewrite, private projects, separate teams, nested subtask trees, or importing Tasker-specific policy into the platform. The mockup is throwaway and is not promoted directly to production.

## Decisions

### Access and sharing

Use explicit membership and a mandatory row privacy boundary that runs before administrative bypass, ordinary grants and explicit shares. The creator identity comes from authenticated server state and is immutable. Creator-only privacy covers direct reads/writes, lists/counts, search, reports/exports, references, realtime, comments/history, files, actions and background processing. It is an application access promise, not encryption against a server/database operator.

Private tasks may be created only for oneself. Assigning private work to another person is refused until the parent is shared. Moving a private task into a shared project shares its description, subtasks, discussion and history atomically, without a confirmation prompt. A shared task cannot return to private ownership. Project moves remain possible; projectless legacy shared work needs migration inspection before classification. Sharing is a one-way state transition, not an inference from a nullable project alone.

Use declared app contracts. Resolve the required generic policy seam with codebase-design and #617 before coding it; do not rely on own_rows_only, which currently permits administrative bypass. Never copy the old checklist's manager access model.

The mandatory seam is versioned Table metadata (`access_policy`), persisted with
the definition. It names required roles and, for creator-owned rows, a shared
flag. Role grants remain necessary but cannot override that ceiling. Direct
document operations and the common list predicate enforce it; attached activity
opens through its target, and realtime rechecks current access before delivery.
Tests exercise the real HTTP document/list interfaces and realtime delivery,
using generic notebook definitions rather than platform references to Tasker.
App role bindings already provide the role-mapping portion of #617; its wider
Apps-page and platform-table capability redesign remain separate work.

### Daily workspace

My Work opens by default; explicit task/project links retain their destinations. Attention first places questions addressed to the current user and replies to their questions above Focus and other assigned tasks. Anyone questions remain visible as open team questions. Private capture goes to the creator's Inbox; project-local creation is shared. Focus and saved preferences stay private.

Reuse supported Shop Floor exports, including tokens, controls, formatters and shell positioning. Extend generic app-facing exports where needed rather than importing platform internals or copying tokens. Use the numbered UI checklist in #563 and independent screenshots at 1280px and 375px, in light and dark.

### Subtasks and discussion

Represent subtasks as metadata-defined tasks linked to a parent, not checkbox-only embedded notes. Limit depth to one and inherit the parent's visibility. Each subtask has responsibility, status and discussion. Runtime validators receive read-only document helpers for their owned Tables. These use the caller’s permissions and the save transaction; a referenced parent is locked before validating a child. The parent completion check holds the parent lock and reads current child state in the same transaction; it cannot race a child being added or reopened. Progress shows child completion without automatically finishing the parent. Preserve Done versus Cancelled distinctions.

Conversations belong to a task or subtask. Each root is an update or question; replies belong directly to that root, without deeper nesting. Questions name a respondent or anyone. A response creates an asker-review state; reading is separate from resolution. Only the asker resolves or reopens. A follow-up from the asker on an unresolved question returns it to waiting for a reply. Ordinary updates have unread state but need no resolution. Do not duplicate free-standing chat or conflate task status with question status.

### Recurrence

Use a recurring definition and separate occurrence records; snapshot task instructions and subtask structure so past history is not rewritten. Carry assignments and privacy; new subtasks start unchecked, and comments/history are not copied to the next occurrence. Sharing an occurrence must not create a loophole that makes that same occurrence private again.

A series has at most one active occurrence. Fixed schedules skip slots that fall while work remains active and resume at the next future slot after completion. After-completion schedules calculate the next occurrence from the completion time. Use the platform scheduler through declared extension points and an idempotent occurrence key with transaction-safe admission; retries and concurrent workers cannot duplicate occurrences.

### Repairs and delivery

Fix silent truncation through real paging, not a larger limit. Resolve activity authors to names. Retain the assertions in existing defect pins and convert them to ordinary tests only when fixed. Publish a new app version with truthful fingerprints and a data-preserving migration ledger. The generic addAccessPolicy operation adds mandatory access to previously unprotected Tables, participates in forward/backward declaration replay, and cannot replace an existing policy. One PR carries every stage and the final spec archive; do not merge partial feature PRs.

## Risks / Trade-offs

- Privacy can leak through a secondary read surface → enumerate those paths and prove denial for ordinary members, Administrator and System Manager, including files and existing shares.
- Old personal tasks were shared and could have been created for someone else → inspect real installed data before choosing a migration mapping; never silently declare historically shared work private or discard it.
- Recurrence has calendar edge cases → settle cancellation, timezone and month-end semantics before recurrence implementation; these are not implied by choosing both modes.
- The old checklist provides reusable concepts, not Tasker subtasks → reuse immediate completion, progress and template snapshots; keep Tasker assignment/discussion and privacy separate.
- A mockup cannot prove access → use real database integration tests and independent browser verification.

## Migration Plan

Boot and smoke-test before implementation. Inventory installed versions and existing tasks; preserve identities, activity, relationships and settings. Add convergence migrations for legacy grants and new metadata, then explicitly configure membership. Prove fresh and upgraded local databases and rehearse changes on a restored target snapshot before any shared-instance rollout. Recovery must not restore broad grants or weaken private visibility. Follow docs/DEPLOY.md and seek the required production approval separately.

## Decisions still needed before affected work

Audit existing data before deciding how to classify historically team-visible personal tasks. Before implementing recurrence, agree what cancellation does to a series, the schedule timezone, month-end rules and whether sharing an occurrence changes future occurrences. Before implementing parent reopening, agree how reopening a subtask behaves when the parent is already Done. These are explicit checkpoints, not permission to guess or blockers to independent work.
