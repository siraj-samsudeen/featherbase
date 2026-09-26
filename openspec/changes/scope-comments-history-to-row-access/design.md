# Design

## Context

`Comment` and `Version` are ordinary metadata-defined Tables with polymorphic `ref_table` / `ref_name` pointers. Generic list, count, aggregate, detail, report, search and realtime code therefore authorizes the activity Table but not its referenced row. `documentActivity` is the correct model: it first reads the parent through `getDoc` and removes Version changes for fields absent from that visible parent.

Two existing behaviors constrain the fix:

- Tasker deliberately uses one generic Comment list, filtered to `tasker.task`, to derive the latest explanation for up to 500 visible tasks. Removing generic Comment reads would break a shipped promise.
- As an observed implementation behavior, not a ratified product promise, direct row shares bypass role, owner and Data Scope checks and grant full sensitive-field visibility for that parent row. Whether history should inherit that visibility is unresolved.

#349 is now on main and exports `scopedWhere` for search. This planning branch predates that merge and must be rebased before implementation; this change does not take on #349's general search corrections.

## Goals / Non-Goals

**Goals:**

- Put one parent-row authorization rule beneath every ordinary Comment/Version read.
- Preserve accurate pagination, totals and aggregates after inaccessible activity is removed.
- Preserve Tasker's bulk Comment query and the parent-gated activity response.
- Make Version values hidden by ordinary role tiers impossible to recover through an alternate read shape.

**Non-Goals:**

- Comment creation authorization, activity retention/deletion, Files, Shares, assignments or the separate permission defects #338/#340/#341.
- General global-search scoping from #349.
- Changing trusted, System Manager-authored Query Reports, which deliberately execute with Administrator read semantics.
- Changing the System Manager-only team feed; System Managers already bypass row and field restrictions.

## Decisions

### 1. Generic activity reads require both grants; document activity requires the parent

The dedicated document-activity operation continues to require only readable access to its parent. It is part of reading that row and must work for a direct share even when the user has no broad Comment or Version grant.

Generic Comment/Version reads continue to require the existing read grant on the activity Table **and** readable access to each referenced row. This preserves Table permission as the gate for standalone lists and reports while removing its ability to bypass parent access. Administrator and System Manager behavior is unchanged.

Alternative rejected: deny all generic Comment/Version reads to non-managers. It is simpler, but breaks Tasker's intentional filtered Comment list and makes existing Comment grants meaningless.

### 2. Add one polymorphic activity-target scope at the query boundary

Add a reusable activity-target authorization helper beside the generic query scoping code. For locally stored targets it builds branches by referenced Table and reuses that target's owner and Data Scope predicate, then widens only that branch with parent row IDs directly shared to the caller. It must not widen ordinary parent lists or search results merely because a row is shared; the widening exists only while deciding whether attached activity is readable.

`scopedWhere` applies this extra predicate for Comment and Version before caller filters and before SQL pagination. Consequently list totals, collection counts, grouped counts, aggregate actions, Report Builder output, auto-email Report Builder output and #349's search path all see the same authorized set.

For a source-bound parent, resolve the candidate parent IDs through the existing source dispatch and combine them with direct shares before selecting activity rows. Do this before pagination/counting; fetching a page and discarding forbidden rows afterward would produce short pages and leaked totals. Settings Tables are authorized as their single named row. Unknown, deleted, cyclic Comment/Version targets are unreadable to non-bypass users rather than recursively authorizing forever.

Alternative rejected: call `getDoc` once for every returned activity row. Besides an N+1 path, filtering after pagination leaks totals and lets inaccessible rows displace readable ones.

### 3. Detail reads use the same target check

After loading a Comment or Version row by ID, generic detail/print/row-action reads authorize its target before returning any value. The check retains the activity Table grant for generic access. The shared helper must accept already-loaded `ref_table` and `ref_name` so detail does not depend on caller-supplied filters.

### 4. Sanitize Version data once, after parent authorization

Extract the Version-change sanitizer currently embedded in `documentActivity`. For ordinary role reads, its visible-field set comes from the parent as the caller sees it and therefore uses permitted tiers. Apply it to document activity, generic Version detail and every generic list/report result that selects Version data. Filtering, ordering or grouping by the JSON payload remains governed by Version's own column permission; the payload returned to the caller is still sanitized.

Alternative rejected: hide the entire Version whenever one changed field is restricted. That also hides allowed changes from the same edit and disagrees with current document-activity behavior.

**Owner decision required before apply:** choose the sensitive-field rule for a directly shared parent.

1. History matches current `getDoc`: the share reveals all current sensitive fields and their historical changes.
2. History remains tier-filtered even though the same share currently reveals the row's sensitive current values. This is more conservative for history but intentionally inconsistent.
3. First change direct-share field semantics so both the row and its history honor tiers. This is the coherent privacy alternative but is broader than #342 and needs its own approved scope.

The current code establishes only the implementation fact behind option 1; it does not establish that option as product intent. Do not implement direct-share Version expectations until the owner ratifies one option.

### 5. Use document activity in row UI; retain Tasker's scoped bulk query

Admin Comments and ActivityTimeline share one cached document-activity request rather than issuing independent generic lists. Posting a comment invalidates that activity key. Tasker's task-detail request already uses document activity and stays unchanged. Its app-wide latest-explanation query remains a generic Comment list and is protected by the new parent scope.

### 6. Do not expose broad activity realtime channels

The current `list:Comment` and `list:Version` channels disclose row IDs and cannot apply a different parent predicate to each event. Refuse those broad subscriptions to non-bypass users. A `row:Comment:<id>` or `row:Version:<id>` subscription requires the generic Table grant plus authorization of the loaded activity target. Parent-row channels and the payload-free manager feed remain unchanged.

Alternative rejected: make publish asynchronous and authorize every event for every subscriber. That is a broad realtime redesign for no current product need.

## Risks / Trade-offs

- **[Polymorphic scope becomes a second permission compiler]** → Build it from the existing target `scopedWhere` result and direct-share helper; test owner-only, direct Data Scope, reference Data Scope and direct-share cases against both list and detail.
- **[Source-bound targets require extra remote work]** → Group candidate IDs by target Table and batch through the source dispatcher before applying pagination; add an asymmetric source-backed regression if comments can be attached there.
- **[A future read path bypasses the helper]** → Put list/count/aggregate enforcement inside `scopedWhere`, detail enforcement inside `getDoc`, and keep a route inventory regression for search/reports/realtime rather than route-local patches.
- **[Version JSON leaks through a new projection]** → Centralize sanitization and test full serialized responses for forbidden old and new values, not only field names.
- **[Integration with #349 conflicts]** → Rebase onto current main before implementation, retain its exported `scopedWhere`, and let the new activity predicate flow through it; do not duplicate or revert its search tests.

## Migration Plan

No schema or data migration is required. Deploy the server authorization change before or with the UI switch; the old UI remains functional against the narrowed generic lists during a rolling local restart. Rollback is the code revert.
