# Five-phase ERP framework comparison

## Purpose

Evaluate how an application foundation supports progressively richer behavior and a declarative ERP framework, while exposing time, corrections and UI quality at small owner-reviewed checkpoints.

## ADDED Requirements

### Requirement: Activate requirements one phase at a time

The comparison MUST apply only the current authorized phase and previously accepted phases. Each phase MUST preserve its source, original failures, corrected results and retained data before owner review. Passing tests MUST NOT authorize the next phase. Later requirements MUST NOT be imposed on Phase 1 or used to penalize its deliberate simplicity.

#### Scenario: Stop after a small delivery
- **WHEN** all three Phase-1 candidates have independent acceptance results
- **THEN** the manager presents working previews, measurements and gaps, and stops for owner approval before Phase 2.

### Requirement: Phase 1 provides only basic persistent CRUD

The application MUST expose an unauthenticated shared Todo list through a browser and ordinary JSON HTTP operations. A Todo has a stable ID and a text title. Users MUST create, list/read, rename and delete records without affecting other records. Duplicate titles MUST have distinct identities. Confirmed data and deletions MUST survive a browser reload and an application restart against the same PostgreSQL database. Titles MUST render as text, not executable markup.

Phase 1 has no custom title validation, completion, filters, Projects, version conflicts, idempotency/recovery workflows, generated contracts, polish gate or framework extraction. Do not disable native parsing/type checks or safe SQL to achieve simplicity. Document basic requests and run commands; generated OpenAPI starts in Phase 2.

#### Scenario: Basic lifecycle
- **WHEN** I create `Buy milk` twice, read both, rename one to `Buy bread`, and delete the other
- **THEN** the remaining record retains its ID and new title, including after reload and restart, and an unrelated sentinel record is unchanged.

### Requirement: Phase 2 evolves populated data without resets

Starting with the retained Phase-1 database, the application MUST first add nullable `priority`, accepting `low`, `normal`, `high` or null. The intermediate revision MUST be executable and preserved. A second migration MUST backfill nulls to `normal` and enforce NOT NULL. Afterwards, create/update requests explicitly supplying null or unsupported values MUST be rejected without writes; creation omitting priority MUST use `normal`, and a partial update omitting priority MUST retain its previous value. The UI MUST allow reading and changing priority.

Both migrations MUST preserve IDs, titles, deletions and existing non-null priorities. Fresh installation, reruns, failed migration/retry, and concurrent migration attempts MUST leave truthful migration history and intact data. Migration execution MUST be separate from normal web startup; startup MUST NOT seed/reset data or report ready with an unusable schema.

#### Scenario: Tighten a field with existing data
- **WHEN** the nullable revision contains one null, one `low`, and one `high` priority and the second migration runs
- **THEN** only the null becomes `normal`, every ID/title is preserved, and direct SQL attempting to store null fails.
- **WHEN** migrations rerun or run concurrently
- **THEN** they safely complete or clearly refuse a concurrent attempt, without duplicates or false applied entries.
- **WHEN** migration permissions cause a failure and are restored
- **THEN** retry completes without deleting existing data or marking the failed work applied prematurely.

### Requirement: Phase 2 has an authoritative typed and validated contract

Browser endpoint request and response types MUST derive from the server contract, not separately maintained interfaces or fetch-result assertions. Runtime checks MUST enforce incoming requests and outgoing application JSON against their declared structural constraints, including required fields, types and declared value restrictions. Raw-response paths, casts and serializer coercion MUST NOT silently bypass those checks. An invalid application response MUST fail as a controlled server error, not be sent as a successful payload.

OpenAPI 3.1 MUST be generated from authoritative schemas and served over HTTP for independent clients. Published operations MUST include distinguishable invalid-input, missing-record and server errors. Documentation generation alone is not validation. Custom business rules MUST be documented and tested separately when not representable in structural schemas. Browser runtime response validation is not required; server runtime output validation is.

#### Scenario: Detect contract drift and output bypasses
- **WHEN** a temporary incompatible endpoint field-type change is introduced without adapting its browser consumer
- **THEN** client type checking fails; retain the diagnostic and restore the source afterwards.
- **WHEN** isolated negative controls make real response paths return a missing required field, a wrong primitive type, or a disallowed declared priority
- **THEN** create/read/update and error paths enforce their declared contracts instead of leaking the invalid success payload, silently coercing it or relying solely on an external test validator.
- **WHEN** an independent HTTP client sends an invalid priority or malformed request
- **THEN** it receives the documented client error, stored records stay unchanged and subsequent valid requests work.

### Requirement: Phase 3 adds Projects and dependable Todo writes

Users MUST create, list/read, rename and delete Projects with stable IDs and titles, and assign, reassign or unassign a Todo to one Project. Existing Todos MUST migrate as unassigned. A missing Project reference MUST be rejected; deleting a referenced Project MUST be rejected with an explanation, leaving both records intact. Project selection/filtering MUST not silently lose or reassign Todos. These are relationship CRUD requirements, not scheduling, memberships or a full project-management product.

Todos MUST gain completion/reopening, initially open, and All/Open/Completed filters with immediate saved membership. Creation/rename MUST trim Unicode White_Space at the ends, preserve internal text/composition, and accept 1–200 Unicode code points with no internal U+000A, U+000D, U+0085, U+2028 or U+2029. Rejections MUST preserve input and saved data. Previously retained invalid titles MUST be identified by a preflight; the migration MUST refuse with an actionable report rather than silently rewrite/delete them. Use valid retained baseline titles for the common comparison.

#### Scenario: Relationship lifecycle
- **WHEN** I create Projects A and B, assign a Todo to A, then move it to B
- **THEN** its ID, title, priority and completion remain unchanged, A can be deleted, and deleting referenced B is rejected until I unassign the Todo.
- **WHEN** I complete a Todo while viewing Open
- **THEN** it leaves Open immediately and appears in Completed without delayed filtering for test convenience.

### Requirement: Phase 3 preserves intent across failure and concurrency

Todo edits, completion, priority/project changes and deletion MUST reject stale or missing version proof, including changes away and back and competing writes to different fields. A conflict MUST retain the proposed input and display the latest saved values beside it before deliberate retry. Acting on a deleted Todo MUST explain absence, preserve recoverable draft text and never resurrect it.

Known read/write failures MUST offer usable retry, preserving drafts and last confirmed state. An uncertain creation MUST retain the original submitted values and request identity and reconcile before risking a duplicate. Either lock new input until resolution or retain any replacement draft independently. Recovery MUST NOT clear a newer draft or be erased by unrelated actions, including an unrelated successful write or lost reply. Blocking unrelated mutations until reconciliation is permitted; if enabled, both operations must remain recoverable. Known create failure MUST still support Retry; finding no record during Check status MUST allow a safe retry. Pending repeated activation MUST NOT cause duplicate creation. These recovery/concurrency requirements apply to Todos; Project CRUD does not add a second full conflict matrix.

#### Scenario: Two sessions disagree
- **WHEN** two sessions edit the same observed Todo and one commits first
- **THEN** the other is rejected, can compare latest saved values with its retained proposal, and can deliberately retry with current proof; two writes against one version cannot both succeed.

#### Scenario: Committed response is lost
- **WHEN** First commits but its reply is dropped, then I attempt an unrelated Todo completion
- **THEN** either that action is blocked pending reconciliation, or its success/lost reply leaves both outcomes recoverable; First is stored exactly once without reload and any permitted Second draft survives recovery and can be saved separately with a fresh identity.
- **WHEN** the initial create never reaches the server
- **THEN** status/retry recovers without retyping or duplicate records.

### Requirement: Phase 3 proves operational failures against the real process

Database outage MUST fail readiness and writes truthfully, without false success or silent fallback storage, and recovery MUST work when the database returns. Graceful shutdown and forced termination MUST stop the actual listener, not only its launcher. The same build MUST restart immediately with preserved data and deletions. Daemon-owned resources MUST release the exact instance's name before restart and MUST NOT stop unrelated services.

#### Scenario: Outage and immediate restart
- **WHEN** the database becomes unavailable and then returns, followed by graceful and forced application restarts
- **THEN** readiness tracks usability, failed writes do not appear saved, the old listener is gone before relaunch, and confirmed identities/values/deletions remain intact.

### Requirement: Phase 4 delivers consistent keyboard and error-state polish

The UI MUST use the same approved visual brief across candidates and support keyboard-only creation, editing, priority/project selection, filters, deletion, correction, retry and conflict resolution. Enter inside create and rename title inputs MUST submit; Escape in a rename editor MUST cancel without saving. Opening rename MUST focus its input. After create/save/cancel/delete/status resolution/conflict review, focus MUST reach a connected, enabled, visible control appropriate to the next action, not BODY or a disabled input. Focus can settle on the next render frame; acceptance MUST wait for a bounded visible state rather than synchronously race rendering.

Loading, pending mutation, success, failure and uncertainty MUST be distinguishable. Obsolete success or Saving messages MUST clear when a subsequent validation error, conflict or completed recovery supersedes them. Invalid fields MUST have associated messages and accessible invalid state. Feedback MUST be announced appropriately without conflicting duplicate alerts. Latest saved values and proposed replacements MUST remain visible together during conflict review.

Controls MUST have accessible names, logical tab order, visible focus, non-color-only meaning and no keyboard traps. Layout MUST remain usable at 320–1440 CSS pixels and actual 200% browser zoom, with long text and no clipped actions or page-wide horizontal scrolling. Automated checks MUST be distinguished from manual screen-reader, contrast, zoom and real-device observations; an unperformed check MUST remain unassessed, never claimed as certification.

#### Scenario: Use text inputs and recover with the keyboard
- **WHEN** I create with Enter in the input, rename with Enter, cancel another rename with Escape, and recover a failed/conflicting write without a mouse
- **THEN** each intended action occurs once, drafts survive, focus stays usable after rendering, and feedback describes the current operation rather than stale success or Saving text.

### Requirement: Phase 5 defines the Todo application declaratively

The extracted framework MUST express the Todo application through inspectable declarations: resources, fields/defaults/constraints, relationships, standard actions, list/form presentation, filters and the previously accepted validation/recovery behavior. Generic framework code MUST generate/interpret the ordinary persistence/API/UI paths; copied per-resource controllers, clients, forms or lists do not qualify. Existing Todo and Project data and all accepted behavior MUST survive extraction.

Resource definitions MUST be loadable at runtime without rebuilding the server or browser. Code types describe the generic resource protocol; dynamic field values MUST still be validated from the authoritative runtime definition. This does not require compile-time knowledge of a field introduced after compilation. Schema changes MUST go through explicit safe migration/activation, not incidental DDL on ordinary requests.

#### Scenario: Reuse outside the original Todo app
- **WHEN** the same compiled framework loads a new Supplier definition with `name`, optional `website` and a Project relationship through its documented definition mechanism
- **THEN** its API, form, list, validation and relationship handling work without core edits or copied resource handlers, existing Todos/Projects remain unchanged, and the API document reflects the active definition.

### Requirement: Phase 5 exposes named extension points instead of hidden exceptions

Any app-specific behavior unsupported by the declarative vocabulary MUST attach through documented, named extension points referenced by the application definition. Extension code MUST remain separate from framework core; no Todo-specific conditionals, monkey patches or undocumented callbacks qualify. Extensions are trusted application code, not an untrusted-code sandbox. Runtime resource loading does not require hot-loading arbitrary new executable code; extensions can be registered at build/startup and referenced by name later.

Each exposed point MUST document its purpose, typed input/output, invocation order, transaction boundary, failure/rollback behavior and allowed side effects. Unknown extension names or incompatible declarations MUST fail activation clearly before serving the new definition. Standard validation, concurrency and recovery guarantees MUST continue around extensions; extensions MUST NOT create an unchecked write/response path.

Demonstrate at least a named custom server validation point and a named field-rendering point, registered outside the core and selected declaratively. Use a test-only rule rejecting the exact title `Reserved` to prove custom validation without changing the ordinary Todo contract. The custom renderer MUST preserve field labels, keyboard access and errors. External after-commit side effects, if offered, MUST NOT be described as transactional or exactly-once without evidence.

#### Scenario: Extend without forking
- **WHEN** a test definition enables the named `Reserved`-title validator and its custom field renderer
- **THEN** browser and direct API writes that violate the rule fail without partial data changes, valid writes work, and the custom UI preserves keyboard/error behavior without editing core.
- **WHEN** the definition references an unknown extension
- **THEN** activation fails with its name and reason, while the previously active application remains usable.
- **WHEN** the test extension is disabled in the declaration
- **THEN** ordinary Todo behavior returns without deleting or rewriting framework code.
