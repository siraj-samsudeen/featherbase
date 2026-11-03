## Context

Issue #873 reproduced on published main `66a93582e6e2633935e1ffa28eedbab2a5fe6ef9`: a real fixture Table was created, visited, deleted, and still offered after browser reload. `ResumeStrip` selects directly from `recentActions`; `eventSummary` and personal activity replay stored names and paths. #769 deliberately addressed history reconciliation, not destination validity.

`table_def` has no stable lifetime identifier. Migration 0012 only sets the Table definition's title column. `renameTable` inserts a new definition then deletes the old one inside its transaction. `renameDoc` changes an existing row's primary key and repoints attached activity. Neither currently repoints navigation events. The metadata/public key exception in ADR 0009 remains unchanged.

Planning authority: manager approval on 03-Nov-2026 under standing reversible-default authority, not owner review. Implementation requires a fresh apply instruction. Existing ADRs were read; ADR 0015 partially supersedes 0010/0014 process rules, and 0017 supersedes 0016's immediate coverage gates. The remaining platform, metadata, source and test boundaries stand.

[Lightweight component/data-flow diagram and consolidated spec-review findings](https://ampcode.com/artifacts/visuals/873-planning-history-stays-immutable-destinations-are-rechec-34211a4e-db00-45c9-9444-249d4358dbf6). The diagram is a planning model, not application evidence; the server boundary owns identity and authorization, the event store owns testimony, and the browser renders only validated Home projections.

## Goals / Non-Goals

**Goals:** usable Home resume destinations, actual rename continuity, honest noninteractive deleted/unavailable activity, immutable original event values, and current authorization on binding and resolution.

**Non-goals:** custom-Table rename routes, #865 column/import provenance, #777/#871 rename discovery, a general identity framework, sidebar/search/routine redesign, restoration of already-lost historical rename information, or any staging/source-data modification. Only My activity's event projection changes; Team's existing authorization and change-feed contract remain intact.

## Decisions

### 1. Separate navigation identity from recorded testimony

Give each `table_def` a server-generated internal UUID, with a named UNIQUE DEFERRABLE constraint. Creation assigns a fresh value; generic Table create/update, overrides, exports and effective metadata must neither accept nor expose it as a user property. Existing definitions receive IDs in the schema migration, not by rewriting events.

`renameTable` explicitly defers that constraint inside its existing transaction, copies the old identity into the new definition, then deletes the old definition and restores/checks uniqueness before leaving the transaction. There is no event foreign key to `table_def`: a missing bound identity is how a later read recognizes confirmed Table deletion. Copying with an immediate unique constraint would fail at insert; cascading deletion would erase the evidence. Keep the natural name primary key and all current metadata pointers unchanged.

A disposable PostgreSQL probe on the isolated issue database exercised this exact constraint sequence: two definitions temporarily shared one UUID, the old definition was removed, immediate uniqueness rechecking succeeded with one surviving definition, and the entire probe rolled back. This validates the constraint mechanism only; the real app-rename and failing-upgrade regressions remain apply tasks.

New events receive nullable server-authored destination metadata, proposed as `user_event.destination jsonb`. NULL means an untouched legacy event. New unresolvable/unreadable events receive an explicit unavailable marker, not NULL, so they cannot later masquerade as legacy candidates. Table destinations bind a Table UUID; row destinations additionally bind a navigation-only row-target UUID. Original `kind`, `ref_key`, `label`, `sub_label`, `path`, `occurred_at`, authors and timestamps remain unmodified.

Capture that navigation reference with the successful authorized Table/row route read, separately from editable Table/row properties, and carry it internally with the recorded action through the existing deferred delivery queue. Otherwise a delete/recreate between the visit and the three-second event POST could bind the wrong lifetime. At delivery, the server treats the supplied reference as a claim, validates its current target and caller access, and never substitutes a new same-name identity if the original claim no longer resolves. Neither the cache nor a caller-supplied UUID is an authorization grant. Missing identity on a new Table/row post is unavailable, never rebound by name or treated as a legacy event. Keep the reference out of authored metadata/overrides and ordinary editable row values; choose the existing response envelope or response metadata seam during apply, not a new public identity route.

Rejected: rewrite recorded paths at rename time, infer identity from a name, or use physical relation names/OIDs as permanent identity. Each confuses testimony with current pointers or loses identity through actual DDL. This feature adds navigation metadata only, not a new public identity API or universal row key.

### 2. Row-ID rename needs a small navigation-only pointer

For visited native rows, keep `navigation_row_target` metadata: UUID, Table UUID, current row ID, original row creation timestamp and a retired marker. It is created lazily when an authorized route read captures a navigation reference, not for every business row. Multiple visits to the same lifetime reuse that target. Event metadata refers to its UUID, never a mutable ID alone.

Inside the existing authorized `renameDoc` transaction, move the matching live navigation pointer to the new ID, preserving its UUID and birth timestamp. Inside native deletion, retire that pointer in the same transaction. A new row using an old ID receives a different pointer. On reads, compare the live row's creation timestamp to its target's birth timestamp as a further guard against same-ID replacement. Do not make user events Reference columns that would block deletion or enter the generic history-repoint sweep.

Use consistent locking for bind/rename/delete: acquire the target definition lock before a native row lock, and upsert its navigation pointer only after the authorized row/lifetime is verified. Recheck under the lock rather than permitting a rename/delete between identity lookup and insertion. Table rename/delete take the corresponding incompatible definition lock. A failed or rolled-back lifecycle transaction must roll back pointer changes too.

Rejected: only refresh row titles (does not follow primary-key renames), or guess old/new IDs from matching titles. No change to the public rename operation or its permissions is needed. Source-bound rows cannot be renamed here today; use their existing authorized source-read path, never write a source identity column or infer source-side key renames. A source without a trustworthy lifetime marker cannot establish an old row's continuity and must fail closed for ambiguous legacy identity.

### 3. Legacy resolution is read-only and deliberately incomplete

For NULL destination metadata, parse the original kind/key/path consistently, look up the named live Table, and require its original creation time to be strictly earlier than the event's recorded occurrence. For native row references also require the current row's original creation time to be strictly earlier. Timestamp equality, missing/invalid birth timestamps, old names after an untraceable rename, or a newer same-name replacement are unknown—not deleted and not a guessed match. Do not use best-effort access-log text as an identity ledger.

Do not UPDATE or physically backfill any old `user_event` row, even when a live target can be established. A legacy event can be resolved again on each read. NULL remains NULL. This means an old event may become unavailable after a subsequent rename if it never had a stable binding; this irreversible historical limit is intentional. A newly recorded visit thereafter is bound normally.

Rejected: migration-time backfill, name similarity, or unconditional name reuse. A client-supplied visit timestamp is not evidence sufficient to attach an already-bound event to another Table generation.

### 4. Resolve centrally, then project for the caller

A navigation-target module owns destination binding, resolution and the small lifecycle pointer operations. Events and Home/activity projections consume it; Table/row lifecycle invokes only its identity/pointer operations. Reuse existing authorization and source dispatch rather than raw unrestricted row queries. Avoid import cycles by keeping lifecycle helpers independent of document reads and resolving document-read dependencies lazily if needed.

The server validates new-event kind/key/path agreement and in-app route shape, obtains the authenticated caller itself, checks current Table/row access, and assigns destination metadata. Clients cannot supply trusted identities or external replay paths. An inaccessible or invalid event may retain its original testimony in its author's trail, but never gains a usable destination binding. Unexpected database failures propagate; permission/missing-target conditions produce an explicit unavailable outcome.

At every Home/activity read, resolve the bound identity, current app availability, current Table/row permission (including own-row/Data Scope/share behavior), row existence and field-tier-safe title. Build the canonical in-app path from that result; never echo a stale raw path as a usable destination. Preserve valid list mode/filter payloads without moving this issue into filter-replay repair. Group available resume candidates by destination lifetime and view/filter identity rather than mutable key alone, so an unavailable latest lifetime cannot overwrite an older usable one.

Outcomes are `available`, `deleted_table` (a previously validated bound Table UUID no longer exists), and `unavailable` (identity ambiguous, row missing, current access denied, app unavailable, or an unsupported destination). Only `deleted_table` carries the caller's own historical Table name for strikethrough. Denied/unknown responses contain no usable path or newly resolved title; use a generic unavailable label instead. No existence probe through the denied result.

Reject a UI-only lookup or permission-free metadata check: it cannot authorize row destinations and may leak titles. Keep My/Team separation and caller-scoped history queries unchanged. Available activity can use current authorized destination names while the persisted event remains untouched.

### 5. Home is a validated projection, not another cache reconciler

Keep `/api/events/summary` and `replaceServerEntries`'s #769 cache/journal semantics intact. Add a bounded caller-scoped Home-resume projection (proposed `POST /api/home_resume`) that resolves the server trail and a bounded set of local recent candidates. Local entries are hints, not authority: match persisted events where possible; otherwise validate the captured navigation reference or apply the same conservative birth-time and access checks. Never let an unbound cached candidate override a rejected bound server identity for that visit. Limit body size/candidate count; fetch enough older candidates within the existing history scan bound to choose the latest usable row/view/search.

`ResumeStrip` renders only the projection's available entries. Loading and failed validation expose no cached destination tiles; no local `recentActions` fallback or title-query fallback can re-add a rejected destination. Home-query invalidation covers local visit changes, event acknowledgement, session changes, relevant live data/metadata changes, and returning to Home; clear prior-user/previous-validation rendering while a required recheck is outstanding. Ordinary page/search candidates keep existing behavior only when their route/access is independently valid; searches refill the command bar, not a stored URL. Do not broaden #769's sidebar/command-bar failed-summary fallback.

For My activity, a deleted Table's recorded name is struck through in a plain span (including the Table sublabel of a row entry); the whole deleted entry is noninteractive. Unavailable entries use plain muted text with an explicit unavailable description, no deletion styling and no focusable destination. Keep counts, times, day groups, tabs, layout and current styling. Issue #873 carries the numbered UI checklist and mockups; generated mockups are design references, not verification.

Rejected: filter the saved history itself, merge a filtered summary back through the unconfirmed journal, or optimistically render a stale local tile. Those risk erasing history or reintroducing deleted destinations. No changes to RoutineCard/pinned-workspace behavior in this issue.

## Risks / Trade-offs

- Unknown legacy identity cannot be repaired honestly → leave the event intact and unavailable; do not falsely mark it deleted. Existing SAP history is not rewritten by this plan.
- A Table UUID alone cannot follow row-ID rename → bounded navigation row metadata participates in the existing native rename/delete transactions; no universal row UUID migration.
- Duplicate Table UUID during insert-new/delete-old rename → named deferrable uniqueness, explicit transaction constraint deferral, no event FK to the replaceable definition, regression with real app rename and rollback.
- Cached validation may outlive access/data changes → revalidation/invalidation and ordinary route authorization; no claim that a browser can predict a permission change before receiving new server state.
- Validation adds latency → batched, bounded reads, grouped by target; pending/failed Home checks omit tiles rather than exposing an unverified fallback.
- Outside sources do not promise detectable delete/recreate generations or key-rename history → do not invent continuity or issue external writes. Existing source access rules still apply.
- New metadata is not old testimony → only new events gain bindings; retention remains the existing policy, with navigation row metadata reclaimed only when no retained event refers to it and it is retired.

## Migration Plan

Plan `apps/server/migrations/0016_navigation_destinations.sql`. Live check on 03-Nov-2026: published main has 0001–0006 and 0012; PR #838 reserves 0013, #870 reserves 0014, #847 reserves 0015. Other open migrations include #845/0008 and legacy #805/0006–0007b and #818/0138. Do not renumber or absorb them. Recheck inventory immediately before authoring 0016 and report any collision to the manager.

The additive migration gives current definitions internal identities, creates navigation row metadata, and adds nullable destination metadata to events. It must not change old event values or bind old events. Validate with an isolated migrated database and byte-for-byte old-event snapshots; rehearse any eventual live migration on a restored snapshot under docs/DEPLOY.md. This plan does not authorize that live operation. Once new identity-bound events exist, do not casually drop their metadata on rollback; roll back application code while retaining additive schema, or restore an approved snapshot as a separately authorized operation.

Shared-file boundaries: `apps/server/src/table-engine.ts` (internal Table lifetime and actual rename/delete only), `document.ts` (native row rename/delete navigation pointers only), `events.ts` (new-event binding; preserve summary contract), `index.ts` (authorized route-read navigation metadata, bounded Home endpoint and My projection), `meta.ts`/`platform-schema.ts` only as necessary to hide/reserve internal metadata. New coherent navigation module; `HomeRecall.tsx` and `ActivityFeed.tsx` for presentation; `AdminLayout.tsx`/route recorder and recents changes limited to carrying validated internal navigation claims and validation-query notifications/candidate transport, never reconciliation semantics. Avoid other workers' reading-presentation, row-numbering, override, import-provenance and route-slug changes in these shared files.

## Open Questions

No owner question remains for this planning pass. Fresh apply authorization is required. The navigation-only row-pointer detail follows the requested actual-row-rename/reuse contract and must be checked in ordinary hidden-logic review. No extra adversarial review is authorized.
