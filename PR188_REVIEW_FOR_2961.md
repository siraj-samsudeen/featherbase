# PR 188 review against the forecast-override expectations in PR 2961

Reviewed local refs on 2026-09-01:

- `featherbase` PR 188: `ed492e68225e7e261ab22e389bdcadbfab9c3e9a`
- `data-warehouse` PR 2961: `3f40540f6381a54eb320b6c142eff5a3a449be3c`

## Bottom line

PR 188 is a strong engine for one specific shape: a **Featherbase-native, wide, mutable budget table** whose changes address concrete rows and numeric cells. PR 2961 is a different shape: an **externally reflected, append-only decision overlay** over immutable model versions, where one decision may target a hierarchical scope, precedence chooses the in-force decision, and superseded decisions remain available for grading.

Therefore, merging PR 188 does **not** by itself unblock moving PR 2961 onto Budget Books. The useful overlap is approval, immutable submitted changes, reasons, snapshots, stale-at-approval checks, and audit. Four architecture gaps must be settled first:

1. external-source data locality and transaction ownership;
2. append-only overlay mode instead of mutating the model table;
3. scope-addressed decisions instead of row-ref expansion;
4. optimistic concurrency from what the editor saw, not merely from the last draft save.

Do not solve the 10,023-leaf case by raising `MAX_CHANGE_LINES`. A Kerala push is one node-level decision and must remain one decision; expanding it to leaves changes its arithmetic and audit meaning.

## Blocking findings

### P0 — Externally reflected tables are explicitly rejected

Evidence: `apps/server/src/budget.ts:141-145` rejects any `TableMeta` with `data_source`. PR 2961 installs `forecast.override_ledger`, `forecast.engine_version`, `forecast.leaf`, `forecast.kurti_slot`, and `forecast.override_grade` through a Postgres `source` reflection.

Even deleting that guard would not make the feature work:

- Budget Books reads and writes native physical table names through the control-database `sql` client (`budget.ts:210-211`, `475-485`, `541-548`).
- Reflected rows must use the source dispatch/driver API.
- `SourceDriver` exposes individual `insert`/`update`/`remove` methods, not a transaction that can also atomically commit the native `Budget Change` status (`apps/server/src/sources/types.ts:92-119`).
- The Postgres driver owns a separate pool and transaction context from the Featherbase control database.

Required decision:

- **Recommended:** keep model/output tables reflected and read-only, but make the human decision ledger Featherbase-native. Add a Budget Book overlay mode that appends approved decisions. This keeps approval status + decision insert in one database transaction.
- Alternative: add source-driver transactions and a cross-store consistency design (2PC, outbox, or compensating state). This is materially larger and should not be hidden behind removal of the binding guard.

Acceptance test: install the real PR 2961 manifest/topology, baseline or activate governance, approve one decision, and prove that the submitted change and appended decision are all-or-nothing.

### P0 — Row refs plus a 200-line cap cannot represent hierarchical scope

Evidence:

- `MAX_CHANGE_LINES = 200` at `apps/server/src/budget.ts:22` and enforced at `controllers/budget-change.ts:76-79`.
- A revise/transfer line requires one `line_ref`; a new line requires one complete key (`controllers/budget-change.ts:110-130`).
- Import handles volume by chunking into separate drafts (`actions/budget-import.ts:104-122`, `217-225`).

PR 2961 needs:

- Kerala push: 10,023 leaves;
- store 1501: 902 leaves;
- division owner: one division across all 16 stores, intentionally with no store key;
- nullable scope dimensions where `NULL` means “all”;
- one push counted once at its node and once in each ancestor, never once per leaf.

Raising the cap or producing 51 drafts is incorrect. It loses one-decision atomicity and, for additive pushes, risks multiplying the amount by the number of leaves—the exact bug PR 2961 fixed.

Required design: add an **append-decision target** with structured nullable scope/payload, or a first-class `target_kind = row | scope`. A scope decision must remain one stored decision. Domain SQL may resolve its leaf reach and roll-up placement later.

Acceptance test: approving a ₹1 Cr Kerala push creates one immutable decision and `v_rollup` shows ₹1 Cr, not ₹10,023 Cr; the change contains no 10,023-line expansion.

### P0 — The apply path bypasses the bound table's validation lifecycle

Evidence: `applyChange` performs raw SQL `update`/`insert` and then manually calls only `recordVersion` (`apps/server/src/budget.ts:481-485`, `541-548`). It does not run:

- metadata/Zod validation and required-field handling;
- table controller hooks;
- Document Event Server Scripts;
- reference validation except a hand-written subset for new-line key columns;
- source dispatch and source optimistic locking;
- app automations normally attached to `saveDoc`.

This is decisive for PR 2961. Its correctness depends on rules such as:

- a weight edit logs all five weights summing to 100%;
- a push moves target, not forecast, and cannot carry a day;
- quantity belongs only to a slot buy;
- reason/name are nonblank;
- the ledger is append-only.

PR 2961 correctly backs these with Postgres constraints, so raw SQL would still hit those constraints in that one application. But Budget Books claims to be generic; applications that rely on Featherbase validators can be bypassed by an approved change.

Required design: expose a transaction-aware internal document write that runs the normal validation pipeline while carrying an explicit “Budget engine apply” capability to bypass only the governance lock. For an overlay book, approval should validate and append the full decision document through that path.

Acceptance test: attach a controller/Server Script constraint to a governed table, propose a violating change, and prove approval is refused atomically.

### P0 — The stale check does not protect what an editor originally saw

PR 188 protects only the interval **last draft save → approval**. `resolveLines` intentionally re-snaps every line on every save (`controllers/budget-change.ts:30-43`), and validation overwrites `current_value` from live data (`:155-159`).

Consequent failure mode:

1. buyer B opens a value showing 100;
2. buyer A changes it to 120;
3. buyer B saves a proposal for 110;
4. the server silently re-snaps B from 100 to 120;
5. B can approve 110 without a conflict unless it changes again after that save.

This is the same lost-edit class reproduced in PR 2961. PR 188's approval check alone does not solve it.

Required design: carry a client-observed revision/value separately from the engine-computed snapshot. On first save and every later edit, compare the observed token with live state and return `409 Conflict` on mismatch. Do not silently overwrite the observation token. For external Postgres rows, use `external_modified`; for native budget cells, use a row revision or explicit expected cell values.

Acceptance test: two editors open the same value; A commits; B's first save is refused and names the current/observed values. Also retain the existing draft-save → approval conflict test.

## Important model gaps

### P1 — PR 188 mutates the budget; PR 2961 keeps model and decisions side by side

PR 188 approval replaces values in the bound table. PR 2961 requires:

- immutable engine/model numbers;
- an append-only override ledger;
- an in-force projection derived from precedence;
- `superseded` derived at read time, never stored;
- all entries, including superseded ones, available for grading.

Binding the current override ledger as a normal wide Budget Book does not preserve those semantics. `new_line` also requires every key field and refuses a colliding key, whereas the ledger deliberately accepts repeated same-scope decisions so “latest” can win.

Recommended follow-up: add `Budget Book.mode = mutate_rows | append_decisions`. In append mode, submitted `Budget Change` rows stay immutable and approval appends one application decision record; the application owns precedence/read projections.

### P1 — The change schema cannot carry the forecast decision payload

`Budget Change Line` carries only `line_ref`, `measure_column`, scalar `current_value`, scalar `proposed_value`, `delta`, and `new_line_key` (`migrations/0082_budget_books.ts:71-90`). PR 2961 decisions need, atomically:

- engine `version_id`;
- role and actor identity;
- nullable hierarchy scope;
- `entry_type` and `measure` (`forecast`, `target`, `quantity`);
- effective date window;
- basis/reference/slot;
- scalar value and/or a five-entry JSON weight vector;
- observation text and reason.

Required design: a typed application payload/attributes object for append mode, validated as one document—not 5 unrelated scalar change lines. The authenticated server must derive actor identity and the applicable actor role; do not trust a client-supplied rank.

### P1 — Changes are not anchored to the model version they were proposed against

Budget snapshots exist, but a `Budget Change` stores no base `Budget Version`, and no engine/model version identifier. Cell snapshots detect some live mutations, but they cannot answer “which model run did this human judgment evaluate?” or preserve an inactive model run for later grading.

Required design: store `base_version`/`model_version` on the change and copy it immutably to the applied decision. Refuse or explicitly rebase when the active model changes.

### P1 — Role/scope precedence and authorization are absent

`owner_column`, `crosses_owner`, and `over_doa` are approval-routing facts. They do not implement PR 2961's adoption rule: most-specific scope, then CEO > business head > buyer > store manager, then latest. Nor do they prove a user is allowed to propose for the scope encoded in a decision.

This precedence can remain application SQL, but Budget Books must preserve the fields it needs and record the actor role server-side. Add tests proving viewers cannot propose and actors cannot claim a stronger role/scope.

### P1 — `new_line` cannot populate required non-key/non-measure fields

For new rows, the controller permits only complete key columns plus numeric measures, and `applyChange` inserts those fields directly. A real decision row has required nonnumeric metadata (`entry_type`, `measure`, `version_id`, `role`, `reason`, dates). There is no legal payload path for those columns.

Append mode/full-document payload solves this. Do not keep adding forecast-specific columns to the generic Budget Change schema.

## Additional PR 188 correctness findings

These are independent of PR 2961 but should be tracked before calling the engine production-safe.

### P1 — “One non-closed book per table” is check-then-insert, not a database invariant

`controllers/budget-book.ts:56-66` performs a lookup, but migration 0082 creates no partial unique index. Two concurrent book creations can both pass, after which `activeBookFor(... limit 1)` silently chooses one.

Fix: partial unique index on `budget_book(ref_table) WHERE lifecycle <> 'closed'`, with a mapped validation error and a concurrency test.

### P1 — Baseline can race a final direct edit

`baselineBook` reads the bound rows into v0 and only then changes lifecycle to `active` (`budget.ts:281-283`). It locks the Budget Book row, not the bound table. A concurrent ordinary edit can observe `working`, commit after the snapshot read, and leave “current” different from v0 before any Budget Change exists.

Fix: lock the native bound table/rows against writes for the baseline transaction, or introduce a `baselining` state/revision protocol. Test with two real transactions.

### P2 — Import proposal materialization is compensating, not atomic

Large imports create each draft in its own `saveDoc` transaction, then best-effort delete earlier drafts if a later one fails; cleanup errors are swallowed (`actions/budget-import.ts:249-273`). This is not equivalent to one transaction and becomes more important as chunk count grows.

Fix: add transaction-aware `saveDoc` support and create all drafts in one control-database transaction, or document/return a proposal batch with explicit partial/retry semantics.

## Small fixes already applied locally

On local branch `codex/pr-188-budget-compat`:

1. `Budget Change` validation now trims `reason` and rejects whitespace-only values. This matches PR 2961's “no reason, no save” database rule.
2. stale-conflict messages now use `change.row_id`; they previously rendered the change name as `undefined` because `change.name` is not the document key.
3. tests pin both behaviors.

Verification:

```text
pnpm exec vitest run test/budget-books.test.ts test/budget-import.test.ts test/budget-demo.test.ts
3 files passed; 45 tests passed

pnpm --filter server typecheck
passed (server + test TypeScript configs)
```

## Recommended sequence

1. Merge PR 188 only after its own normal review; do not claim it unblocks PR 2961.
2. In PR 2961, add the editor-observation stale guard now. It is a real local defect and does not depend on Budget Books.
3. Write a small follow-up Featherbase spec for `append_decisions` mode. Settle data locality before code.
4. Implement full-document validation inside the approval transaction.
5. Add scope-addressed decisions that stay as one row; leave forecast precedence/roll-up arithmetic in forecast SQL.
6. Anchor every proposal to the model version it was made against.
7. Run an integration slice using the actual forecast schema and these cases:
   - Kerala push is one decision and rolls up once;
   - division scope crosses stores without a store key;
   - five-weight vector is atomic and sums to 100%;
   - same-scope role precedence and more-specific-scope precedence;
   - superseded entry remains immutable and gradeable;
   - model version changes do not silently rebase a proposal;
   - two-editor stale conflict happens on first save and again at approval;
   - viewer/scope authorization is enforced;
   - reason is nonblank;
   - submitted change + appended decision are all-or-nothing.

## What should remain application-specific

Budget Books should not absorb forecast-domain SQL such as leaf-set containment, CEO/business-head precedence constants, off-track runs, grading formulae, GST conversion, day decomposition, or Excel export. It should provide the safe primitives: authenticated proposal, observed revision, approval, immutable decision, version anchor, atomic append, and extensible validated payload. PR 2961 should continue to own the forecast projection and reporting semantics.
