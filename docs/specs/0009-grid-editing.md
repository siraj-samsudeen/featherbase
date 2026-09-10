# Feature: Grid editing of existing rows

**IDs:** `GRD-J*` journeys · `GRD-R*` rules · `GRD-I*` invariants · `GRD-H*` hazards
**Evidence:** one verdict per obligation; linkage checked by `pnpm check:evidence`.
**Provenance:** [#259 and its owner decisions](https://github.com/siraj-samsudeen/featherbase/issues/259).
The six decisions and conflict refinement, followed by the native-only,
scalar-editor, receipt, and in-memory-draft decisions, define this scope.
The accompanying Oracle design decisions define the requirements below,
not a component architecture. This specification starts from current main
after PRs [#213](https://github.com/siraj-samsudeen/featherbase/pull/213),
[#261](https://github.com/siraj-samsudeen/featherbase/pull/261),
[#265](https://github.com/siraj-samsudeen/featherbase/pull/265), and
[#263](https://github.com/siraj-samsudeen/featherbase/pull/263).
[#187](https://github.com/siraj-samsudeen/featherbase/pull/187) is historical
reference only: neither its retired wire format nor its prototype is a base.

## Jobs and scope

GRD-J1 — Correct several existing business rows with spreadsheet keys, without opening each Form.

GRD-J2 — Keep another person's unrelated changes and decide explicitly when both people changed the same value.

GRD-J3 — Leave or recover from a failed save without silently losing pending work or saving it twice.

Grid is an edit-on-demand alternative beside the ordinary List/Form path
for eligible native, non-system business Tables. New and Import retain
ownership of creation; the existing read-only Peek retains ownership of
preview. A Form remains the full metadata-driven editor.

**Non-goals:** Datasheet, ghost rows, Quick Add, editable drawers, reflected
Grid editing or a reflected read-only Grid mode, reflected-driver changes,
collaborative presence/cursors, spreadsheet ranges, multi-cell clipboard,
fill handles, cross-row atomic saves, complex field editors, durable
crash/reload drafts, cross-device draft recovery, and a general undo system.
No ordinary PATCH concurrency guarantee is weakened. List/Peek/Form on
reflected Tables retain their existing permissions and behavior.

## Prior state and agreement cases

Input is residue of New/Import, not a new file format. Prepare a
journey-owned native business Table **Grid Orders** and two existing rows
through ordinary Table/row creation. Use metadata-driven fields:

| Row | Title (Data) | Quantity (Int) | Price (Currency) | Active (Check) | Stage (Choice) | Due (Date) | Appointment (Datetime) | Customer (Reference) |
|---|---|---|---|---|---|---|---|---|
| A | Cedar | 7 | 12.50 | false | Draft | 2026-10-03 | 2026-10-03T09:15:00Z | Customer East |
| B | Birch | 23 | 4.75 | true | Review | 2026-11-17 | 2026-11-17T16:40:00Z | Customer West |

Also declare a required field outside the displayed columns (already
populated), a restricted-tier scalar, a read-only scalar, and a complex
field. Create referenced Customers first. Branch setups vary permission,
workflow/status, Table kind/source, validation and automation deliberately.
Two independent signed-in sessions, Alice and Ben, can initially read and
edit A and B; a read-only principal and a principal restricted to own rows
exercise refusals. IDs A/B stand for the real `row_id` values returned by
creation, never row positions or display labels.

**Limits:** this benign prior state settles visible examples, not all
metadata, locale, numeric or race boundaries. Rules require generated typed
values and controlled interleavings as well. No fixture file or renamed
legacy test is claimed as Grid evidence.

## GRD-J1 — Edit existing rows with the keyboard · `shape: sequence`

> evidence: gap #259 — specified browser and screen-reader walk; no Grid implementation or asserting journey exists.

**Isolation:** use a journey-owned Table and principals, pre-clean through
Table deletion, create references before orders, then remove orders before
references. Reset branch state independently; report blocked setup or skips
as such, never a pass. Enter through the sidebar after signing in.

| # | Where / do | Must observably see | Bug if | Rules |
|---|---|---|---|---|
| J1.1 | Grid Orders list — choose Grid | A and B in a cell-selectable Grid; New, Import and the usual Form/Peek paths remain available according to permission | Grid creates a blank extra row | R1, R2, R11 |
| J1.2 | Select A's Quantity; use arrows, then type 11 | Selection moves between cells; typing opens an editor replacing 7 with 11; the row is visibly dirty | Typing appends to 7 or writes a different row | R3, R4 |
| J1.3 | Press Enter | The edit commits, selection moves down to B's Quantity, and A shows saving then saved | Moving down silently drops 11 | R4, R6 |
| J1.4 | Select B's Title, press F2, change Birch to Birch South, press Escape | Birch is restored; selection remains coherent; previously committed edits are not undone | Escape clears another pending field | R4, I2 |
| J1.5 | Edit B's Price to 8.25; use Tab then Shift+Tab | The value commits and selection moves horizontally in the chosen direction; at the Grid edge focus can leave safely | Tab traps focus or creates a row | R3, R4, R7 |
| J1.6 | Open A in Peek, then use the Form path | Peek reads A including Quantity 11 without an editor; Form provides full editing including complex fields | Peek becomes a second editable drawer | R1, R7 |

**Branch steps:**

| # | Where / do | Must observably see | Bug if | Rules |
|---|---|---|---|---|
| J1.7 | Open a reflected, settings, child, system or engine-managed Table | The appropriate existing permitted surface, without a Grid option | Source writability alone exposes Grid | R1, R2 |
| J1.8 | In an eligible Table, inspect a submitted/cancelled row or a row with unreadable, read-only, restricted or unsupported fields | Readable content and ordinary permitted navigation remain; unreadable values are absent and ineligible targets have no inline edit control | An absence check passes because the whole page disappeared | R1, R2, R3 |
| J1.9 | With a screen reader, edit a cell and move to the next row | Row/column identity, selection versus editing, and dirty/saving/saved states are announced; the editor has a field label | Only color communicates save state | R4, R10 |

## GRD-J2 — Two people change the same row · `shape: sequence`

> evidence: gap #259 — asymmetric two-session merge/conflict walks are required; no execution evidence exists.

**Isolation:** fresh J1 prior state in two independently authenticated
browser contexts; control save/response barriers rather than sleeps. Reset
A to its initial state before each branch through the ordinary lifecycle.

| # | Where / do | Must observably see | Bug if | Rules |
|---|---|---|---|---|
| J2.1 | Alice and Ben both open A; Alice changes Title to Cedar East and leaves the row | Alice sees Cedar East saved | The save changes Quantity 7 | R5, R6, I1 |
| J2.2 | Ben, still looking at the original A, changes Quantity to 11 and leaves the row | Both sessions eventually show Cedar East and 11, without a conflict prompt | Ben's save restores Cedar | R5, R8, I1 |
| J2.3 | Start again; Alice saves Quantity 19; Ben proposes Quantity 11 and Price 8.25, then leaves A | A conflict names Quantity and shows originally loaded 7, current 19, proposed 11; Ben's Price also remains pending | Price saves despite the Quantity conflict | R5, R6, R10 |
| J2.4 | Ben cancels the conflict dialog | The server keeps Quantity 19 and Price 12.50; Ben can still copy, adjust or explicitly retry both pending proposals | Cancel means discard, or automatically resends | R6, I2 |
| J2.5 | Ben reopens review and explicitly confirms the displayed overwrite | If Quantity is still 19, both proposed values save together; other people's unrelated fields survive | Confirmation unconditionally overwrites a newer value | R5, R6, R9 |

**Branch at J2.5 — changed again:** before Ben confirms, Alice saves
Quantity 29. Ben sees a renewed conflict with current 29 and proposed 11,
and Price stays 12.50 on the server. Bug if the old confirmation permits
11 over 29, any partial write occurs, or repeated dialogs auto-confirm.
Verification: R5, R6, I1.

**Branch at J2.3 — permission revoked:** remove Ben's right to read the
row or conflicting field before the response. Ben sees an authorized
refusal rather than restricted current values; no field is changed and
the outstanding work is not called saved. Bug if the conflict is a back
door to a value no longer readable. Verification: R2, R10, H1.

## GRD-J3 — Recover, then leave safely · `shape: sequence`

> evidence: gap #259 — delayed acknowledgment, replay and navigation branches require browser/API coordination; not implemented or executed.

**Isolation:** fresh J1 prior state; control response delivery and inject
failures at named pre-commit/post-commit boundaries. Use an ordinary second
session for concurrent changes, not a fabricated success response.

| # | Where / do | Must observably see | Bug if | Rules |
|---|---|---|---|---|
| J3.1 | Set A's Quantity to 11, leave the row; while saving, return and change it to 13 | 13 remains pending when the earlier save acknowledgment arrives | A delayed saved notice replaces 13 with 11 | R6, I2 |
| J3.2 | While 13 is pending, Ben changes A's Title; refresh data and receive live updates | Ben's unrelated Title can refresh while 13 remains visible and pending | Refresh replaces the proposal or its original comparison value | R6, R7 |
| J3.3 | While editing, request sorting, filtering or a different page/view | The active edit is committed, pending saves finish, and only then does the requested transition occur | A moving row sends the edit to B or disappears unsaved | R7, I2 |
| J3.4 | Save A while its successful response is lost; choose Retry when the outcome is uncertain | The original outcome is recovered; A is saved once, with no duplicated save effects | Retry creates another change or runs the save again | R8, R9, I3 |
| J3.5 | With a pending edit, close or reload the browser | An unload warning where the browser permits one; staying keeps the edit available | The UI promises drafts will survive a crash or reload | R7 |

**Branch steps:**

| # | Where / do | Must observably see | Bug if | Rules |
|---|---|---|---|---|
| J3.6 | Make an invalid quantity or Reference, then try to leave | A field-associated error, preserved proposals and blocked navigation; correcting then explicitly retrying can succeed | The error clears edits or loops requests | R3, R6, R7, R9 |
| J3.7 | Ben submits/cancels A, removes write permission, or makes its field ineligible before Alice saves | An actionable refusal with no partial save; navigation waits unless Alice explicitly discards | A stale eligibility result authorizes a write | R2, R7, R9 |
| J3.8 | Ben deletes A or a filter/refetch no longer returns it while Alice has a proposal | A clearly identified pending/missing row problem remains recoverable or explicitly discardable | Disappearance deletes the draft or silently recreates A | R6, R7 |
| J3.9 | A notification fails after a successful save | A is reported as committed with a separate delivery problem, not as an unsaved row to write again | Delivery failure causes another version on Retry | R8, R9, I3 |

## Rules

### GRD-R1 — Supported Tables and surfaces · `shape: rule`

> evidence: gap #259 — structural support and absence/positive-complement assertions are not implemented for Grid.

**Property:** for every principal/Table, Grid is offered only when the
server declares structural support and eligible editing for that principal;
each ineligible target lacks an editor while permitted existing surfaces remain.

| Table / target | Result | Why? |
|---|---|---|
| Eligible native non-system business Table | Grid available | Initial release scope |
| Reflected source, writable or read-only | Grid rejected | No safe native atomic merge guarantee; no read-only Grid variant |
| Settings, sub-table, system or engine-managed Table | Grid rejected | Not independent business-row editing |
| No server eligibility result, or no edit permission | Editing rejected; no speculative controls | Fail closed, not inferred |
| Supported Table, ineligible row or field | Editor rejected; readable cells/navigation retained | Per-target eligibility, not blanket writability |
| New row or complex-field edit | Existing New/Import or Form | Grid changes existing supported cells only |

No blank insertion row, Quick Add or editable Peek is introduced. Row
identity and existing naming/hidden-required-field rules belong to the
existing creation flows, never inferred from Grid's displayed columns.

### GRD-R2 — Server eligibility is a prerequisite · `shape: contract`

> evidence: gap #259 — Table support and opt-in batched row capabilities require a new authoritative contract; existing action discovery is not permission evidence.

`GET /api/table/:table:meta` exposes Table-level structural support without
mutating cached shared metadata. `GET /api/table/:table` offers opt-in edit
capabilities alongside its paginated, permission-filtered rows. The opt-in
response associates capabilities with `row_id`, includes the loaded
revision and authorized changed-field baseline inputs, and does not alter
ordinary non-opt-in list behavior. Exact option/envelope names belong to
the implementing contract, not an alternate per-row GET API.

One server policy owns structural support and effective principal/row/field
eligibility: read and write grants including tiers, shares/own-row rules,
Data Scopes, status, metadata read-only/workflow-managed fields, and
Table/source restrictions. Only readable and writable supported fields can
be edited. Missing, pending or failed capability data grants nothing.
No per-row capability GET/N+1, role-name guess, `source_writable` inference,
or principal-specific mutation of cached meta is allowed.

`POST /api/table/:table/:row_id:merge_fields` rechecks this policy against
the locked row at mutation time; previously advertised capability is not
authorization. Any ineligible/unknown/identity/system field in a request
rejects the entire mutation, never silently strips it. A stale capability
must not permit changes after revocation, status transition or metadata
change. Read filtering also governs capability disclosure.

This explicitly narrows [TLC-R1.permission](0007-table-lifecycle.md) /
[#249](https://github.com/siraj-samsudeen/featherbase/issues/249): Grid
cannot roll out without this policy. It does **not** claim the separate
New/create-permission affordance gap is resolved.

Verify API grants/refusals and UI absence with positive complements for
every R1 exclusion, field tier, own versus other's row, share, status and
metadata change, including direct crafted mutation requests.

### GRD-R3 — Scalar editors preserve metadata meaning · `shape: rule`

> evidence: gap #259 — typed Grid control examples and boundary properties have no implementing evidence.

**Property:** every eligible scalar edit preserves its metadata type and
ordinary validation/empty-value semantics, and no unsupported value is
silently converted to a different valid value.

| Field / input | Result | Why? |
|---|---|---|
| Short text/Data: Cedar East | Text editor, exact value | Text is not a number guess |
| Int: 11; Float/Currency: 8.25 | Numeric editor, metadata validation | Common numeric scalars |
| Int: abc or 8.25 | rejected | No truncation or NaN success |
| Check: false → true | Boolean control and value | Not string truthiness |
| Choice: Draft → Review | Declared choices only | Invalid choice rejected server-side |
| Date: 2026-10-03 | Same calendar day in every timezone | Date is not a timestamp |
| Datetime: 2026-10-03T09:15:00Z | Same instant through locale display/edit | No silent timezone shift |
| Reference: Customer West | Authorized picker, stable referenced identity | Display label is not row identity; links revalidated |
| Empty optional / empty required | Ordinary nullable meaning / rejected | Never empty-to-zero coercion |
| Long/rich text, JSON, attachment, child collection | Inline editor rejected; Form-only | Initial editor scope |

Unsupported fields may be readable when authorized. Verification uses
properties over typed values plus precision, range, null, timezone and
Reference-permission boundaries; browser checks establish actual control
types and accessible labels. Saving one displayed field preserves an
already-populated required hidden field.

### GRD-R4 — Selection, edit mode and safe keyboard boundaries · `shape: sequence`

> evidence: gap #259 — spreadsheet navigation/edit-mode and IME/browser-boundary walks are specified but unexecuted.

In navigation mode arrows move selection, typing replaces the selected
eligible cell value, and Enter or F2 enters edit mode. In edit mode Enter
commits and moves down; Tab/Shift+Tab commit and move horizontally;
Escape cancels only this edit session and restores its pre-edit value,
including a pre-existing pending proposal. Leaving a dirty row triggers
save. Committing an unchanged value does not introduce a spurious edit.

Arrow/caret keys and editor popovers work within edit mode; navigation
must not steal IME composition or commit on its Enter. Browser/system
shortcuts retain their normal function. At the final/first Grid tab stop,
Tab/Shift+Tab exits to the next/previous reachable control after committing
and initiating any required row save, without wrapping into row creation
or trapping focus. Crossing an application-navigation boundary additionally
obeys R7. Down from the last row never creates one. Ineligible cells can
be selected/read, but typing never opens an editor for them.

Verify keyboard-only forward/reverse boundaries, non-default editor
popovers, composition, Escape on a previously dirty value, and shortcuts,
not just mouse editing. R10 owns names, announcements and dialog focus.

### GRD-R5 — Atomic per-field optimistic comparison · `shape: rule`

> evidence: gap #259 — asymmetric merge, zero-partial-write and conditional-confirmation properties are not implemented.

**Property:** for every authorized changed-field set, the server either
accepts all proposed fields against locked current values or applies none;
a changed field whose current value differs from its submitted baseline
conflicts, and unchanged fields come from the locked row, not the baseline.

Compare metadata-normalized typed values; missing baseline is not null,
and false, zero and empty text must not collapse through truthiness.
The revision is the one loaded, not a fresh read used to manufacture
success. A differing revision alone does not reject non-overlapping fields.
Even when current equals proposed, a changed field differing from baseline
requires review; only receipt replay (R8) proves this is the same mutation.
This is value-based comparison, not a promise to detect an intervening
change that returned to the same value.

| Baseline A | Locked current A | Proposed changes | Result | Why? |
|---|---|---|---|---|
| Cedar, 7, 12.50 | Cedar East, 7, 12.50 | Quantity 11 | Cedar East, 11, 12.50 | Different fields survive |
| Cedar, 7, 12.50 | Cedar, 19, 12.50 | Quantity 11; Price 8.25 | rejected; Cedar, 19, 12.50 unchanged | Same-field conflict means zero partial write |
| Cedar, 7, 12.50 | Cedar, 19, 14.75 | Quantity 11; Price 8.25 | rejected; both conflicts reported if authorized | Detect all conflicts before mutation |
| Reviewed Quantity 19; Price baseline 12.50 | Cedar East, 19, 12.50 | Confirm Quantity 11; Price 8.25 | Cedar East, 11, 8.25 | Explicit confirmation is conditional comparison |
| Reviewed Quantity 19; Price baseline 12.50 | Cedar East, 29, 12.50 | Same confirmation | rejected; Cedar East, 29, 12.50 unchanged | Server changed again after review |
| Quantity 7 | Quantity 11 | Quantity 11 with a new mutation ID | rejected | Equal proposal is not replay evidence |

Primary verification is generated disjoint/overlapping field sets with
asymmetric values and transaction barriers; assert database values and
Version counts on both sides, not merely response status. Include two
simultaneous disjoint requests and a multi-conflict request.

### GRD-R6 — Pending edits and explicit conflict recovery · `shape: sequence`

> evidence: gap #259 — row scheduling, draft generations and conflict recovery require state-machine and browser evidence.

Drafts are keyed by principal, Table, row and field, never display position.
The original baseline/revision and current proposal remain distinct from
refetched data. Each row has at most one in-flight request; sending captures
an immutable generation/payload and does not clear dirty state. A later
edit can coexist with that request but cannot be sent in parallel for the
same row. Acknowledgment settles only what it actually saved; it cannot
mark a newer proposal saved or replace its original baseline with an
unrelated refetch. An acknowledged own write can advance the baseline for
the subsequent same-field generation while preserving that newer proposal;
unrelated dirty fields keep their own baselines. R5 still protects against
another writer between those requests.

States are dirty, saving, saved, conflict, error, and outcome-unknown.
Conflict/error/unknown is a stopped recovery state, not an automatic resend
loop. A successful earlier generation can allow a queued newer generation
to proceed. A lost-response retry uses the exact original payload/ID (R8),
never packages newer edits into that retry.

Conflict review names every authorized conflicting field and shows original
baseline, reviewed server current and proposed values. Cancel closes review
without changing server data or deleting proposals. Explicit overwrite
confirmation makes a **new conditional request** against the reviewed current
values, with a new mutation ID; non-conflicting fields retain their pending
baselines. It is never force/ignore-revision. If the reviewed conflicting
server values or the local proposal changes after review, the displayed confirmation cannot
authorize an unseen overwrite; review the changed proposal/current values
again. Errors preserve drafts for correction, copying or explicit discard.

Realtime/refetch never replaces pending proposals or baselines. Filtered-out,
deleted or otherwise missing rows retain identifiable drafts and recovery
state; they are never silently recreated. Principal changes must not expose
another principal's draft or accept an old response into the new session.
Verify delayed acknowledgments in both orders, row disappearance, cancelled
dialogs, edited proposals during review, and authentication changes.

### GRD-R7 — Leaving, refresh and in-memory durability · `shape: sequence`

> evidence: gap #259 — transition blocking and unload-warning branches are not implemented for Grid.

Controlled transitions (List/Form/New/Import links, Table/view/route changes,
pagination, sort/filter changes, back navigation and controlled sign-out)
commit the active cell, flush pending rows, and await safe outcomes before
unmounting. A local validation error blocks this just like a server error.
Conflict/error/unknown blocks leaving unless the user explicitly discards
pending work. Discard does not cancel an already-committed save or claim to
undo a request already in flight; warn of an unknown outcome and retain the
ability to reconcile it while the session remains. No new mutations are
sent after discard; late acknowledgments cannot resurrect discarded edits.

Defer disruptive live reorder/removal while editing; selection and drafts
follow row identity when order is eventually applied. Non-dirty data can
refresh, but it cannot move the active edit onto another row. A missing row
with a draft stays represented as a recovery problem, not a vanished success.

Browser close/reload while dirty or in flight installs the browser's unload
warning; do not claim custom text or warning delivery where browsers forbid
it. The warning is removed only when no dirty or in-flight work remains;
discarding proposals does not erase an unresolved in-flight outcome.
Drafts stay in memory only. Closing, reloading, crashing or losing the process
can lose proposals; no durable or cross-device recovery is implied.
Test controlled back/forward, view changes, sort/filter/page transitions,
realtime reorder and both staying/leaving at the unload warning.

### GRD-R8 — Existing-row merge and retry address · `shape: contract`

> evidence: gap #259 — merge_fields and atomic idempotency receipts do not exist; no legacy PATCH test proves them.

`POST /api/table/:table/:row_id:merge_fields` is a named write-effect
existing-row action using current `table`/`row_id` identity. GET cannot
mutate it. Ordinary `PATCH /api/table/:table/:row_id` retains its existing
whole-row revision policy; this action is not an insert/upsert escape hatch.

Request carries a client-generated mutation ID, loaded baseline revision,
baseline values for each changed field, and the nonempty changed-field map.
Missing/malformed revision, ID or baseline, unknown/ineligible fields, and
attempts to change identity are whole-request refusals. Baselines are
comparison input, not evidence of read/write authorization or past server
state. Confirmation is R6's new conditional request, never a bypass flag.

Success identifies the mutation and committed revision, with authorized
saved values sufficient to reconcile generations. Conflict identifies the
mutation and all authorized conflicting fields with baseline/current/proposed
values and the reviewed revision. Missing row, permission/eligibility/status
refusal, malformed request and field-validation errors are distinguishable
from conflict and from a committed outcome with post-commit-effect failure.
No response exposes a row/field that current read authorization hides.

A server receipt is scoped by authenticated principal, canonical Table,
row and mutation ID, bound to the immutable payload, and commits atomically
with the row/Version outcome. Concurrent identical attempts resolve to one
commit. Same ID/same payload replays the prior authorized outcome without
rerunning validation, hooks, scripts, notifications or versioning. Same
ID/different payload is rejected, including attempts to add newer local
edits. Confirmation/correction uses a new ID; response-loss retry does not.
Replay re-authorizes current reads, filters fields, and never treats a
historical success as permission to expose a now-hidden/deleted row. It
does not require re-performing the old write to recover its outcome.

Receipt retention must cover the supported retry lifetime; an unavailable
receipt must not make an old accepted mutation execute as new. Any future
expiry scheme must safely reject expired IDs, not silently weaken retry
safety. No exactly-once external delivery guarantee follows from receipts.
Test lost successful responses, concurrent duplicate requests, payload
mismatch, different principals/Tables/rows, read revocation, and post-commit
failure, with exact row/Version/effect counters (I3).

### GRD-R9 — One locked native lifecycle and truthful outcomes · `shape: contract`

> evidence: gap #259 — the new action must prove locked merge/lifecycle ordering and final candidate checks; ordinary save behavior is not evidence of this contract.

At `POST /api/table/:table/:row_id:merge_fields`, one native transaction
locks the current row, rechecks permission/field eligibility/status,
compares every requested field, and refuses all conflicts before mutation.
No conflict runs mutating save hooks or writes a partial row. On acceptance,
merge proposals into the **locked latest row**, then apply ordinary metadata
validation, hooks, scripts, Reference checks and lifecycle restrictions.
Hooks may derive values from the latest unrelated fields: they must not
start from the user's stale whole-row snapshot. Normal hook-derived changes
are allowed by the ordinary lifecycle, not mistaken for stale client fields.

Data Scope checks apply to the finalized candidate after hooks/scripts derive
changes, as well as access to the existing row. A proposed or derived
Reference outside the principal's scope must roll back the whole change.
Validation, hook/script failure, invalid Reference, unique/required failure,
permission, status or eligibility refusal leaves no partial row, children,
successful receipt or Version. Version tracking follows the Table's ordinary
policy and records locked **actual before/after**, including derived values,
not the client baseline. Receipt and Version commit with the row atomically.

Post-commit email/webhook/after-commit failures cannot roll back that row.
Report committed row and post-commit-effect failure separately, so the user
never rewrites a committed mutation to retry delivery. Receipt replay must
not rerun effects. External systems may fail or deliver more than once under
their own delivery policy; this feature does not promise exactly-once
notification delivery or invent a new external-delivery framework.

Verify through the actual action with a hook deriving a field from Ben's
latest unrelated change; assert final scopes both for user-proposed and
hook-derived References, actual Version diff, transaction rollback for each
failure stage, and the committed/not-committed distinction after effect failure.

### GRD-R10 — Authorized status, conflict reads and accessibility · `shape: contract`

> evidence: gap #259 — new response read surfaces and accessible Grid recovery have no executed security/browser evidence.

Success/conflict/replay at `POST /api/table/:table/:row_id:merge_fields` and
opt-in `GET /api/table/:table` capability responses are authorized read
surfaces. Filter them by current row/Data Scope/field read permissions,
including errors and derived values. Do not echo unauthorized values merely
because the caller supplied them. Revocation may return a generic refusal
instead of field detail. Never log mutation payloads, baselines, proposals,
conflict values or sensitive receipt contents. Operational diagnosis can
use authorized mutation correlation and outcome categories without payloads.

Grid exposes row/column names, selection, read-only versus editable state,
and coherent navigation/edit mode to assistive technology. Dirty, saving,
saved, conflict and error have visible text plus accessible live status;
outcome-unknown must not announce saved. Announcements reflect the correct
row/generation, not a stale acknowledgment. Errors associate with the
field and remain discoverable off the active cell. Conflict review is a
labelled modal dialog with reachable confirm/cancel, non-color-dependent
baseline/current/proposed labels, Escape as cancel, managed focus and return
to the originating cell or a meaningful recovery target if the row vanished.

Verify API field/row revocation and payload-free logging; automated
DOM/accessibility checks plus a named human method: an implementer and
independent reviewer walk J1/J2 keyboard-only with a screen reader before
rollout and after changes to focus, editor keys or conflict/status behavior.

### GRD-R11 — Bounded capability and save work · `shape: invariant`

> evidence: gap #259 — no Grid query/request budget has been executed; measurements must accompany implementation.

For a fixed Table/metadata/permission setup, increasing returned rows on a
single list page does not increase the number of capability queries or
capability HTTP requests: use batched evaluation, not one lookup per row.
The opt-in adds no separate row capability requests; response work/data may
grow linearly with returned rows/fields, never with all rows in the Table.
Existing pagination limits remain effective. Baseline capture requires no
fresh per-row read immediately before save.

Mutation traffic is bounded by committed dirty-row generations and explicit
retries, not keystrokes, live events, renders or field count. Simultaneous
requests for one row never exceed one; clean row exits send none. Stopped
conflict/error states send zero requests until explicit recovery. Test 1,
17 and a full allowed page of rows under identical grants (including
own-row/share/Data Scope cases), counting database queries and HTTP requests
separately; report constant capability-query overhead rather than timing
alone. One dirty row with three committed fields produces one save at row
exit, while a clean neighboring row produces none.

## Invariants

### GRD-I1 — A row conflict never partially saves · `shape: invariant`

> evidence: gap #259 — database/Version reconciliation under concurrent saves has no Grid evidence.

Across any interleaving, accepted client fields plus ordinary derived
changes are applied together to the locked row, preserving unrelated latest
values; rejected mutations contribute zero row changes and zero Versions.
For version-tracked changed rows, one accepted mutation contributes one
ordinary Version; its before/after is the actual committed transition.
Verify with R5's unequal two-session cases and R9 failure injection.

### GRD-I2 — Pending generations are conserved · `shape: invariant`

> evidence: gap #259 — generated event-sequence reconciliation and browser witnesses are absent.

Every locally committed field generation remains pending, is superseded
by an explicit newer local edit, is acknowledged for its own saved value,
or is explicitly discarded; no send, stale acknowledgment, refresh,
reorder, row disappearance or dialog cancellation invents a fifth outcome.
Active-cell Escape restores the pre-edit generation rather than discarding
it. A response for one principal/Table/row cannot settle another. Reconcile
these categories over generated edit/send/ack/error/refetch/navigation
sequences and witness J3.1 in a browser with a real delayed response.

### GRD-I3 — Retry does not repeat a committed lifecycle · `shape: invariant`

> evidence: gap #259 — receipt/row/Version/effect reconciliation is specified, not implemented.

For any number of identical retries of a successful mutation, committed
row transitions = 1 and successful receipts = 1; Version additions = the
single ordinary save's count. Hook/script/notification invocation counts
do not increase on replay. A post-commit-effect failure may mean external
delivery count is zero or uncertain, never that committed row count is
zero. Reconcile both a lost response after full success and a failure after
row/receipt commit but before all effects finish.

## Compound hazards

### GRD-H1 — Conflict recovery becomes a data leak · `shape: contract`

> evidence: gap #259 — combined revocation/conflict/replay security tests are required and absent.

A caller forges baselines or loses read permission while awaiting a write,
then conflict or receipt replay discloses restricted values. R2, R8 and R10
jointly require fresh authorization and filtering, rejection rather than
stripping, and payload-free logs. Verify the merge_fields response and logs
after row and field revocation, including a previously successful receipt.

### GRD-H2 — Moving rows plus delayed saves lose work · `shape: sequence`

> evidence: gap #259 — the compound reorder/navigation/acknowledgment walk is unexecuted.

Live reorder, navigation unmount and an old acknowledgment together can
erase a newer edit or apply it to the wrong row. R6/R7/I2 preserve identity
and generations and await controlled transitions. Walk J3 with A moving
past B, a dirty off-page/missing row, delayed success, then a conflict on
leaving. Assert proposals, selected identity and blocked navigation together.

### GRD-H3 — Retry disguises a committed save as failure · `shape: contract`

> evidence: gap #259 — lost-success/post-commit-failure/replay interleavings need real transactional evidence.

The row commits but its response or external effect fails; retry runs hooks
again and overwrites a newer proposal. R6/R8/R9/I3 separate immutable replay,
new generations and external delivery. Exercise merge_fields with receipt
commit, response loss and a newer local edit; recover the old outcome without
discarding the newer generation or invoking the lifecycle twice.

## Closure sweep

- Actors & permissions: R1/R2/R10/H1 — server policy, tiers, shares, own rows, Data Scopes and revocation.
- Prior state & lifecycle (including reversal): R1/R3/R9 — existing rows, required hidden values, status; Cancel is not undo, explicit discard is not rollback.
- Concurrency & retries: R5/R6/R8/I1/I2/I3 — locked field comparison, conditional confirmation, generation ordering and receipts.
- External-dependency failure: R9/H3 — References validated; post-commit delivery failure distinguished; reflected drivers excluded.
- Durability & recovery: R6/R7/R8 — in-memory proposals, controlled navigation, unload warning, reliable committed-outcome replay without a crash-recovery promise.
- Security & privacy: R2/R9/R10/H1 — baseline is not authority, finalized candidate scope, filtered conflict/replay and no payload logs.
- Accessibility: R4/R10/J1.9 — keyboard/IME/shortcuts, safe Tab, screen-reader status and conflict focus.
- Performance & scale: R11 — paginated batched capabilities and bounded dirty-row request counts, measured separately from latency.
- Observability: R8/R9/R10/I3 — mutation identity, truthful committed state, version trail and non-sensitive outcome categories.
- Compound hazards: H1/H2/H3 — adversarial combinations, not isolated happy-path checks.

## Phased slices and review gates

1. **Authoritative eligibility prerequisite:** R1/R2/R11 capability portion,
   with permission-filtered Table/list contracts and exclusion tests. Narrow
   TLC-R1.permission explicitly; no Grid editing rollout on inferred flags.
2. **Atomic native mutation and retry:** R5/R8/R9/R10 response security,
   I1/I3/H1/H3. Prove two-session comparison, finalized candidate scope,
   actual Version diffs and receipt/lifecycle ordering before a UI sends it.
3. **Grid interaction and recovery:** R3/R4/R6/R7/R10 accessibility,
   I2/H2 and all three journeys. Include the initial scalar editors and
   stopped conflict/error recovery; complete bounded-work measurements.

These are dependency slices of one release, not permission to ship an
unsafe partial Grid. Independent final spec/code review and focused Oracle
review of the locked lifecycle, eligibility and retry boundaries precede
merge/rollout. This specification PR does not implement or close #259.

## Open questions

None requiring a new product decision in this scope. The owner decisions
are incorporated as requirements. Exact request/envelope spelling beyond
the named route and required semantic fields, and implementation mechanics,
are implementation choices subject to contract review, not new product
scope. Any later contradiction between examples, properties and prose is
blocked for **Siraj Samsudeen** to arbitrate; update all representations
together rather than letting code or tests silently choose.

## Evidence and review artifacts

Every obligation is `gap #259`: no Grid implementation, expected-failing
pin or legacy-test alias is asserted by this spec. Proposed verification
methods above describe future work, not executed results. A future test
quotes the obligation it actually asserts; do not rename old tests merely
to satisfy linkage. Run `pnpm check:evidence` for the derived tally.

The Markdown specification is the review source. The current
`pnpm manual:build` generator is scoped to spec 0008's spreadsheet-import
guide; it must remain reproducible, but supplies no Grid review page or
Grid screenshots. Do not hand-author HTML or fake screenshot evidence.
Generating an additional Grid guide requires a later explicit generator
extension; this specification does not modify the import-only generator.
