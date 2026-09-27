# Release 1 — Persisted Todo application (Gate 1 draft)

## Purpose

Let a person manage a small shared Todo list reliably through an accessible browser UI or discoverable JSON HTTP functionality, while comparing technology stacks without prescribing their internals.

## ADDED Requirements

### Requirement: Release boundary and OpenSpec authority

The application SHALL provide one shared Todo collection without authentication. Release 1 SHALL include only create, read, rename, complete, reopen, delete, and status filtering. It SHALL NOT introduce Projects or a reusable CRUD framework, resource DSL, generic repository, plugin system, or speculative abstraction. Each candidate SHALL install and use OpenSpec and retain the identical approved behavior specification; candidate-specific planning SHALL NOT weaken it. Changes to approved behavior require manager review and owner approval before implementation. No deployment is authorized.

#### Scenario: Same product across all stacks
- **WHEN** a new browser session opens the application
- **THEN** it can manage the shared collection without an account or sign-in
- **AND** the candidate's OpenSpec artifacts contain the approved release-1 requirements without stack-specific substitutions.

### Requirement: Create and identify todos

The application SHALL let users create a Todo with a title. A new Todo SHALL be open. Each Todo SHALL have a stable, distinct identity independent of its title; duplicate titles SHALL be allowed. Confirmed success SHALL represent durable storage, not merely a local optimistic display. A single submission SHALL NOT create multiple records through repeated activation while that submission is pending.

#### Scenario: Create an open Todo
- **WHEN** a user submits `Buy milk` once
- **THEN** one new open Todo named `Buy milk` is visible in the All and Open views, but not Completed
- **AND** success is communicated and the create input is ready for another entry.

#### Scenario: Duplicate titles remain distinct
- **WHEN** a user deliberately creates `Buy milk` twice in two completed submissions and deletes one
- **THEN** the other remains unchanged.

### Requirement: Title normalization and validation

Titles SHALL be strings containing 1–200 Unicode code points after trimming leading and trailing Unicode White_Space characters. Normalization SHALL preserve case, internal whitespace, and Unicode composition; it SHALL NOT silently truncate. Line breaks (U+000A, U+000D, U+0085, U+2028, U+2029) remaining after trimming SHALL be rejected. These same rules SHALL apply to creation and renaming through both UI and HTTP. Invalid writes SHALL change no persisted data, and the UI SHALL explain the problem while retaining the entered text for correction. Titles SHALL render as text, never executable markup.

#### Scenario: Normalize without rewriting content
- **WHEN** a user creates or renames with `  Buy  milk  `
- **THEN** the saved title is `Buy  milk`.

#### Scenario: Validate boundaries
- **WHEN** a user submits an empty or whitespace-only title, a 201-code-point title, or a title with an internal line break
- **THEN** the write is rejected with an actionable title error and no record is created or altered
- **AND** the entered text remains available to correct
- **BUT WHEN** the normalized title contains exactly 1 or 200 code points, including non-BMP characters
- **THEN** it is accepted.

#### Scenario: Treat titles as text
- **WHEN** a Todo title contains `<script>alert(1)</script>`
- **THEN** the title is displayed literally and no script executes.

### Requirement: Rename, complete, reopen, and delete

Users SHALL be able to rename a Todo without changing its identity or completion state, complete an open Todo, reopen a completed Todo, and delete either kind. Each operation SHALL affect only the selected Todo and communicate its outcome. A confirmed deletion SHALL remove the Todo from every view and from subsequent reads. A deliberate delete action is required; confirmation dialogs and undo are not required.

#### Scenario: Rename and change completion state
- **GIVEN** open `Buy milk` and completed `Send invoice` todos
- **WHEN** the user renames the former to `Buy oat milk`, completes it, and reopens it
- **THEN** it retains its identity and ends open with the new title
- **AND** `Send invoice` remains unchanged.

#### Scenario: Delete without disturbing another Todo
- **WHEN** the user deletes `Send invoice`
- **THEN** it no longer appears in any status view or subsequent read
- **AND** `Buy oat milk` remains.

### Requirement: Filter by completion state

Users SHALL be able to choose All, Open, and Completed views. All SHALL be the initial view of a newly opened application. Filtering SHALL not mutate records. The selected filter and each record's completion state SHALL be perceptible without relying on color. Successful mutations SHALL update membership in the active view. Empty collections and empty filtered results SHALL be distinguishable from loading and failure. Ordering and persistence of the selected filter across reloads are not prescribed.

#### Scenario: Filter a mixed list
- **GIVEN** open `Buy milk` and completed `Send invoice`
- **WHEN** the user selects All, Open, then Completed
- **THEN** the views show both, only `Buy milk`, then only `Send invoice`, respectively.

#### Scenario: Complete the last open Todo
- **WHEN** the user completes the last Todo while viewing Open
- **THEN** the view indicates no open todos, not a load failure
- **AND** that Todo is available in Completed.

### Requirement: Durable PostgreSQL persistence

PostgreSQL SHALL be the authoritative persistent database. All acknowledged successful writes, identities, titles, completion states, and deletions SHALL survive browser reload, an independent browser session, and an application-server stop and restart against the same database. Reads after a confirmed write SHALL reflect that write unless a subsequent write superseded it. The application SHALL NOT require browser storage for persisted records or silently fall back to volatile storage when the database is unavailable.

#### Scenario: Reload and restart preserve the collection
- **GIVEN** one renamed open Todo, one completed Todo, and one deleted Todo
- **WHEN** the user reloads, opens an independent session, and later restarts the application server against the same database
- **THEN** the surviving identities, titles, and states are unchanged and the deleted Todo stays absent.

#### Scenario: Database unavailable
- **WHEN** the database cannot accept a write
- **THEN** the application does not confirm success or pretend the write was persisted
- **AND** it communicates failure or uncertainty while preserving editable input.

### Requirement: Recoverable request failures

The UI SHALL indicate pending work and recover from transient read and write failures without a full page reload. A definitively failed create or rename SHALL retain the user's entered text. A definitively failed complete, reopen, or delete SHALL not leave the view falsely showing confirmed success. A read failure SHALL be distinguishable from an empty list and offer retry. If delivery is ambiguous, the UI SHALL not falsely report either confirmed success or confirmed non-commit; it SHALL offer reconciliation with server state before a blind repeat can duplicate a creation. Offline operation and draft survival across page closure are not required.

#### Scenario: Failed create or rename retains input
- **WHEN** a create or rename request is prevented from reaching the server
- **THEN** an error is shown, the entered title remains, and controls become usable
- **AND WHEN** connectivity returns and the user retries
- **THEN** the intended write succeeds without retyping and without duplicate records.

#### Scenario: Failed state change and failed read
- **WHEN** a complete, reopen, or delete request is definitively rejected
- **THEN** the UI retains or restores the confirmed state and offers retry
- **AND WHEN** a list read fails
- **THEN** an error, not an empty-list claim, is shown and retry can restore the view.

#### Scenario: Response lost after commit
- **WHEN** creation commits but its success response is lost
- **THEN** the UI does not claim the record certainly does not exist
- **AND** its offered recovery can establish the saved outcome without creating a second record for that same submission.

### Requirement: No silent overwrite from stale sessions

Every rename, complete, reopen, and delete SHALL be conditional on the Todo state last observed by the actor. If another committed mutation has changed that Todo since that observation, the stale mutation SHALL be rejected without modifying the current record, even when different fields were changed or a value was later changed back. A missing required concurrency precondition through HTTP SHALL be rejected rather than treated as permission to overwrite. The UI SHALL explain the conflict, preserve any typed rename, and allow the user to inspect the latest state and deliberately retry or discard their draft. The concurrency mechanism and wire representation are not prescribed. Automatic background updates are not required, and SHALL NOT erase unsaved input if supplied.

#### Scenario: Two sessions rename one Todo
- **GIVEN** independent sessions A and B both observed `Buy milk`
- **WHEN** A saves `Buy oat milk` and B then tries to save `Buy bread` using its stale observation
- **THEN** B receives a conflict, `Buy oat milk` remains stored, and B's `Buy bread` draft remains available
- **AND WHEN** B reviews the latest state and deliberately reapplies its rename
- **THEN** it can save against that fresh observation.

#### Scenario: State changes and deletion also reject stale observations
- **GIVEN** A and B observed the same open Todo
- **WHEN** A renames it and B attempts to complete or delete it using its earlier observation
- **THEN** B receives a conflict and neither the title, state, nor existence is changed by B.

#### Scenario: Simultaneous writes and changed-back values
- **WHEN** two differing mutations race against the same observed state
- **THEN** at most one commits and the other reports conflict
- **AND WHEN** a title changes from `A` to `B` and back to `A`
- **THEN** a write based on the original observation of `A` is still stale and rejected.

### Requirement: Records deleted elsewhere

An operation against a Todo deleted in another session SHALL not recreate it or affect a different Todo. The UI SHALL explain that it is no longer available, retain any typed rename in a recoverable form, and reconcile the list. Repeating a delete against an already deleted record SHALL report absence or already-deleted status, not a fresh successful deletion. The HTTP contract SHALL distinguish absence from validation and stale-existing-record conflicts.

#### Scenario: Another session deletes an edited record
- **GIVEN** B has a rename draft for a Todo that A deletes
- **WHEN** B attempts to save, complete, reopen, or delete that Todo
- **THEN** B is informed that it no longer exists and the list no longer presents it as a saved record
- **AND** B's rename draft, if present, remains recoverable without resurrecting the Todo.

### Requirement: Accessible and responsive operation

All release-1 flows SHALL meet applicable WCAG 2.2 AA requirements. Controls SHALL have meaningful accessible names and exposed roles/states; title inputs SHALL have programmatic labels; errors SHALL be associated with the relevant input; pending, success, conflict, and failure outcomes SHALL be available to screen readers without requiring a focus hunt. Every action SHALL work by keyboard with visible focus and logical focus order, no trap, and a sensible focus destination after a record or editor disappears. Status SHALL not depend on color alone. At widths from 320 to 1440 CSS pixels, and at 200% text zoom, content and controls SHALL remain readable and usable without overlap or page-wide horizontal scrolling. Long titles SHALL not hide essential actions. Hover-only actions are insufficient.

#### Scenario: Keyboard-only lifecycle
- **WHEN** a keyboard user creates, renames, completes, reopens, filters, and deletes a Todo
- **THEN** all actions are reachable and operable, focus remains visible, and deleting the focused item leaves focus at a meaningful surviving control.

#### Scenario: Screen-reader errors and states
- **WHEN** a screen-reader user navigates the controls, submits an invalid title, corrects it, and later encounters a stale edit
- **THEN** the input purpose, Todo identity, completion state, selected filter, validation error, success, and conflict are programmatically available and the entered text is preserved.

#### Scenario: Desktop and mobile layouts
- **WHEN** the application is used at 1280×800 and 390×844 CSS pixels, then at 320 CSS pixels wide and with 200% text zoom
- **THEN** every release-1 action remains usable, including with a 200-code-point title, with no clipped controls, overlap, or page-wide horizontal scrolling.

### Requirement: Discoverable and enforced JSON HTTP contract

All Todo functionality SHALL be externally available through JSON HTTP without importing application code or requiring its generated client. Each candidate SHALL expose an OpenAPI 3.1 JSON document over HTTP and declare its discovery location in its externally supplied run information. That document SHALL describe how to list and read todos, create, rename, complete, reopen, delete, and filter by state; record identity; normalized titles and completion state; concurrency preconditions; and success, validation, conflict, missing-record, and failure outcomes. Paths, methods, envelopes, client technology, and concurrency token shapes are candidate choices described by that document, not prescribed here. Documented operations SHALL be callable with an ordinary HTTP client. Responses SHALL conform to the published contract and correct HTTP success/error classes; domain errors SHALL be distinguishable by documented machine-readable information. Server-side enforcement SHALL apply independently of UI validation. Malformed JSON, invalid types, invalid titles, invalid filters, and missing required concurrency inputs SHALL be rejected without data changes or unhandled server errors. An unsupported filter SHALL not silently mean All.

#### Scenario: Discover without source inspection
- **WHEN** an external consumer fetches the declared discovery document
- **THEN** it can determine and execute every release-1 operation using that contract alone, including conflict-safe changes and status filtering
- **AND** real success and domain-error responses match their documented schemas and status codes.

#### Scenario: Bypass the browser validation
- **WHEN** a direct HTTP client sends malformed JSON, a numeric or null title, an overlong title, an unsupported filter, or a mutation missing its required concurrency input
- **THEN** the server rejects it with a documented client error and changes no records
- **AND** valid normalized titles and concurrency-safe operations work independently of the browser.

### Requirement: Production-relevant migration behavior

Each candidate SHALL supply a documented, non-interactive migration operation that initializes an empty PostgreSQL database and tracks applied changes durably. Repeating it on an initialized database SHALL be safe and preserve all Todos. Starting or restarting the application SHALL NOT reset, reseed over, or drop existing data. Readiness SHALL not report the application usable when its required schema is unavailable. A failed migration SHALL report failure rather than readiness or successful application; retry after the cause is removed SHALL converge without manual data deletion, lost existing records, or falsely marking unfinished work applied. Concurrent migration invocations SHALL either safely serialize/converge or explicitly refuse one without corruption. Migration and production-run instructions SHALL distinguish data-preserving operations from any disposable development reset. Destructive reset SHALL never be a prerequisite for normal migration or startup. Release-2 additive migration, intermediate rollout, and application rollback requirements are deferred to Gate 5, not presumed proven here.

#### Scenario: Initialize and rerun safely
- **WHEN** migrations initialize an empty database, users create and modify Todos, and migrations are run again
- **THEN** the database remains usable with the same records, identities, titles, and states and no duplication.

#### Scenario: Failure and retry
- **WHEN** a migration encounters a denied database operation or interruption before completion
- **THEN** the command reports failure and does not claim unfinished work is applied
- **AND WHEN** the cause is removed and migration is retried
- **THEN** it completes safely without deleting existing data.

#### Scenario: Competing migration invocations
- **WHEN** two migration invocations target the same database concurrently
- **THEN** they complete safely or one explicitly refuses to proceed, with no corrupt schema history or lost Todo data.
