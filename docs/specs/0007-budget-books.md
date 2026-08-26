# Feature: Budget Books

**IDs:** `BUD-J*` journeys · `BUD-R*` rules · `BUD-I*` invariants ·
`BUD-H*` hazards · `Q*` questions
**Evidence:** `docs/specs/evidence/budget-books.csv` (never status in this file)
**Provenance:** owner design session 2026-08-14 (the "Budget Books"
simulation document and its resolved decisions §6); build authorized
same day. M2 (compare view, propose-change button, pending badge) is
UI over R2/R4/R10 and adds no rules. M3 (import-as-proposal, J4/R12)
authorized 2026-08-17, with the owner's same-day ruling on missing
rows: untouched by default, discontinuable by explicit option.

## The job

BUD-J1 — "I build the annual budget in a spreadsheet the way I always
have; when management signs it off I need that number frozen as the
yardstick, and every change after that to be deliberate."

BUD-J2 — "The budget assigned to my line no longer matches reality; I
need to propose a corrected number with my reason, have the right person
approve it, and see it become the budget — with the trail intact."

BUD-J3 — "I own this budget line and don't need anyone's permission to
change it — but my change must still be recorded and visible to
management."

## The model in one paragraph

A **Budget Book** (`budget_book`) binds to an ordinary Table
(`ref_table`) and declares, via sub-tables, which of its columns are
**key columns** (the grain — opaque to the engine) and which are
**measure columns** (budgeted amounts, ordered, each with a period
label), plus an optional **owner column**. While the book is `working`
the bound table is a free spreadsheet. The **baseline** action freezes
it: snapshot **v0** is written to `budget_version`/`budget_version_line`
and the book becomes `active`, from which point the bound rows accept no
direct writes — every mutation travels through a **Budget Change**
(`budget_change`, submittable), whose approval applies its lines to the
bound table inside one transaction. The engine never interprets the
grain: two books with different dimensions and period shapes run on the
same code with zero per-book logic.

## The agreement dataset — quarterly beverage lines

`store, subcategory, owner, q1, q2, q3, q4` — key = store + subcategory,
measures = q1…q4, owners split between two users (`priya`, `arun`) so
one dataset exercises same-owner and cross-owner walks. Quarterly on
purpose: the engine must not assume twelve months. Seeded inline by the
tests; it graduates to a shared file fixture
(`apps/web/e2e/fixtures/beverages-budget.csv` + `.claims.md`) when the
M3 import-as-proposal journey needs an actual workbook to upload.

**Limits, stated on purpose:** the dataset exercises one grain
(2 key columns) and one period shape (4 quarters). Grain-agnosticism is
proven by BUD-R1's property (any key/measure declaration over any
table), not by a second dataset.

## BUD-J1 — Build, iterate, baseline *(shape: sequence)*

| # | Where / do | Must observably see | Rules |
|---|---|---|---|
| J1.1 | Table Builder, signed in as a manager | Dropping `beverages-budget.csv` creates the typed line table with its rows (existing import behaviour) | — |
| J1.2 | `budget_book` form: create a book naming that table, its key/measure/owner columns, fiscal year | Book saves; status is **working** | R1 |
| J1.3 | The line table's list/form | Rows still edit and re-import freely; a row deletes cleanly — no budget ceremony exists yet | R3 |
| J1.4 | Book form → **Baseline** action | Book status **active**; a `budget_version` row (kind `baseline`, label `v0`) exists with one `budget_version_line` per bound row | R2, R10 |
| J1.5 | The line table again: edit any measure directly | Refused whole-write, naming the book ("2026 Beverages is active — changes go through a Budget Change") | R3 |
| J1.6 | Delete any bound row directly | Refused the same way | R3, R8 |

**Branch at J1.4 — baseline twice.** A second `:baseline` on an active
book is refused; v0 is unique per book. *(→ R2)*

**Isolation strategy:** journey-owned unique names per run; teardown
closes the book and deletes the line table (Table Deletion, spec 0003).
The book row and its applied changes are deliberately permanent
(BUD-R9), so full self-cleaning is impossible by design — the unique
suffix is what keeps reruns independent. No skip path.

## BUD-J2 — Propose, approve, applied *(deltas from J1's active book)*

| # | Where / do | Must observably see | Rules |
|---|---|---|---|
| J2.1 | `budget_change` form (generic FormView) | Create draft: book, type `revise`, required reason, one line (row ref, measure `q2`, proposed value); on save the line shows the **snapped current value** and the computed delta | R4 |
| J2.2 | Submit (approve) the change | Status `submitted`; the bound row's `q2` now equals the proposed value | R5 |
| J2.3 | The bound row's activity timeline | A Version entry with the `q2` before → after diff, dated now | R5 |
| J2.4 | Try to cancel the applied change | Refused — an applied change is history; the road back is a new change | R9 |

**Branch at J2.2 — stale snapshot.** If the line's live value no longer
equals the snapped current value at approval time, the approval is
refused whole-request, naming the line. *(→ R5)*

**Isolation strategy:** rides J1's book inside the same journey run;
server-tier coverage runs in the SQL-sandbox transaction.

## BUD-J3 — Fast lane, still flagged *(shape: sequence, api tier)*

A Workflow on `budget_change` (data, not engine code) gives the owner
role a Draft → Approved transition whose target status is `submitted`.
Applying it as the line's owner: the change applies exactly as J2.2–J2.3
— the workflow path and the submit path converge on the same apply — and
a Workflow Action row records who took the shortcut. *(→ R5, H1)*

**Isolation strategy:** server-tier in the sandbox; the workflow rows
are created inside the test transaction.

## BUD-J4 — The August reforecast: a file becomes proposals *(shape: sequence, api tier)*

The job: "Finance sends the mid-year overwrite as the same spreadsheet
shape as the original. I can't just re-import it — the book is active —
but I also can't retype four hundred cells into change forms."

| # | Where / do | Must observably see | Rules |
|---|---|---|---|
| J4.1 | `POST /api/table/:table:import` with the August rows (the old habit) | Refused rows naming the book **and pointing at `:import_proposal`** | R3 |
| J4.2 | `POST /api/table/:table:import_proposal { rows, reason, dry_run: true }` | The would-be drafts reported — changed cells, new rows, unchanged count, ignored columns — and **nothing written** | R12 |
| J4.3 | Same call without `dry_run` | Draft Budget Changes exist (revise / new_line as the diff demands), each line already snapped and delta'd; nothing applied to the bound table | R12, R4 |
| J4.4 | The drafts in the generic FormView | Reviewable and editable like any hand-made draft — delete a line, adjust a value; approval rides the same lanes as J2/J3 | R4, R5, R11 |
| J4.5 | Approve; open Compare v0 → current | The bound table equals the August file where it spoke, stands untouched where it was silent, and the compare lists exactly the diff | R5, I1 |

**Isolation strategy:** server-tier in the SQL sandbox for the rules;
the browser tier drops a real CSV on the Import wizard, whose governed
path (banner naming the book, required reason, preview, draft links —
the plain import controls absent) is the J4 walk as a typical user
sees it. Unique table/book names per run.

## Closure sweep

- **actors & permissions:** book creation/baseline require write on
  `budget_book` (manager-gated by seeded permission); changes ride the
  existing permission matrix on `budget_change`; lane differences are
  Workflow data, not engine authority (R2, R5).
- **prior state & lifecycle (incl. reversal):** book `working → active →
  closed`, no reverse (R2); un-applying a change = a new opposite change,
  never cancel (R9); reinstating a discontinued line = a `revise` change
  (R8).
- **concurrency & retries:** apply revalidates the snapped current value
  and refuses stale approvals whole-request (R5); overlapping *pending*
  changes per line deliberately deferred (Q1).
- **external-dependency failure:** *(none — the engine touches only the
  local database; bound tables of external `data_source` kinds are
  refused at binding (R1) in M1.)*
- **durability & recovery:** v0 and later snapshots are plain rows,
  surviving any UI; the apply is one transaction (I2); a killed process
  leaves either a draft or an applied change, never a half-applied one.
- **security & privacy:** bound-table RLS and tier rules are untouched
  by the engine; the write-lock adds refusals, never new read paths (R3).
- **accessibility:** M1 adds no bespoke UI; generic FormView/ListView
  carry existing guarantees. *(none — no new surface.)*
- **performance & scale:** snapshot writes one row per line in one
  statement batch; apply saves only referenced lines. Caps: a change
  holds at most `MAX_CHANGE_LINES = 200` lines (named constant, engine).
- **observability:** every applied change leaves the change row itself,
  per-line Version diffs, and (workflow path) Workflow Action rows —
  three trails, one per question: what was decided, what moved, who
  acted (R5).
- **compound hazards:** H1, H2.

## The rules

### BUD-R1 — A book declares its binding · `shape: contract`

`POST /api/table/budget_book` (generated CRUD). A book names a
`ref_table` (must exist, `kind: 'table'`, not externally bound in M1)
and declares ≥1 key column and ≥1 measure column, all existing on the
bound table; measures must be numeric (`Int`, `Float`, `Currency`);
`owner_column`, when named, must exist. A book may also declare its
**policy**: `doa_amount` and `escalation_dir`
(`increase`/`decrease`/`any`) — consumed by R4's `over_doa` fact so a
single workflow condition serves every book. At most one **non-closed** book
may bind a given table at a time — the write-lock must never be
ambiguous. Violations refuse the book save whole-request.

**Property:** for any table and any declaration violating one clause,
the save is refused naming that clause; for any conforming declaration,
the book saves with status `working`.

### BUD-R2 — Lifecycle: working → active → closed · `shape: contract`

`POST /api/table/budget_book/:name:baseline` — only from `working`:
writes the v0 snapshot (R10) and sets `active`. Refused on `active` or
`closed` books.
`POST /api/table/budget_book/:name:close` — only from `active`. No
action reopens a book; status is engine-written, read-only to direct
edits.

### BUD-R3 — Active books lock their table · `shape: contract`

While a book is `active`, the bound table refuses direct row inserts,
deletes, **renames**, and any update that touches a declared column
(key, measure, owner) — whole-write, naming the book. Rename is guarded
at its action (renameDoc runs no lifecycle hooks — audit bug #3): a
renamed row would orphan every `budget_version_line` pointing at its old
name. Updates to undeclared columns (notes, attachments) pass. `working`
books impose nothing. Closing a book releases the lock (the snapshots
and Version trail remain the durable history — Q3 asks the owner to
ratify this release). The refusal names the road that is open: bulk
writes to a governed table are told to use `:import_proposal` (R12).

**Property:** for every bound row and every declared column, a direct
write while active is refused and the row is byte-identical after.

### BUD-R4 — A change computes its own facts · `shape: rule`

A draft change belongs to an **active** book (drafts against `working`
or `closed` books are refused — a working book is edited directly). On
every save the engine snaps each line's `current_value` from the live
bound row, computes `delta = proposed − current`, `total_delta`,
`crosses_owner` (true when the referenced lines' owner-column values
span more than one owner; always false when the book declares no owner
column), and `over_doa` (against the book's `doa_amount` in the book's
`escalation_dir`; false when no threshold is set). Lines must reference existing
bound rows (except `new_line`) and declared measure columns. A change
holds at most `MAX_CHANGE_LINES` lines.

| # | change_type | line_ref | measure | proposed | outcome | Why? |
|---|---|---|---|---|---|---|
| 1 | revise | existing row | q2 | 95000 | saved; current snapped, delta computed | the plain path |
| 2 | revise | missing row | q2 | 95000 | rejected | a change must point at reality |
| 3 | revise | existing row | q9 | 95000 | rejected | q9 is not a declared measure |
| 4 | revise | existing row | q2 | (empty) | rejected | a proposal proposes a number |

**Property:** after any sequence of draft edits, every line's
`current_value` equals the live bound value at last save time, and
`total_delta` equals the sum of line deltas.

### BUD-R5 — Approval applies, atomically, through the front door · `shape: contract`

`POST /api/table/budget_change/:name:submit` — and equally any Workflow
transition whose target status is `submitted` — applies every line to
the bound table **in the same transaction as the status change**, via
the full row-save lifecycle (hooks, validation, Version diffs — never
raw SQL). Before applying, each line's live value is compared to its
snapped `current_value`; any mismatch refuses the whole approval naming
the line. After apply, the change is `submitted` and immutable.

Behaviours (no example table — rows would restate the rule):
- submit path and workflow path produce identical bound-table outcomes;
- one Version entry per changed bound row, diffing exactly the applied
  measures;
- a failing line (validation, stale snapshot) leaves every other line
  and the change status untouched (→ I2).

### BUD-R6 — A transfer nets to zero · `shape: rule`

A `transfer` change is refused at save and at approval unless its line
deltas sum to exactly zero across the change (overall, not per-period —
owner decision 2026-08-14).

| # | lines (delta) | outcome | Why? |
|---|---|---|---|
| 1 | −200000 / +200000 | saved | money moved, none created |
| 2 | −200000 / +150000 | rejected | −50000 escaped the budget |
| 3 | −200000 / +150000 / +50000 | saved | three-way split still nets zero |
| 4 | single line −200000 | rejected | a transfer has two ends |

**Property:** for any applied transfer, the book's grand total over all
measures is identical before and after.

### BUD-R7 — A new line arrives complete and unique · `shape: rule`

A `new_line` line carries no `line_ref`; its `new_line_key` JSON must
supply **every** key column (and nothing else), and the key must not
collide with an existing bound row. Lines sharing one key are one birth
carrying several measures; the (key, measure) cell must be unique within
the change. On approval the engine inserts one row per distinct key with
the proposed measures (absent measures default to 0). The born row's
provenance is the change itself (platform Version covers updates only —
by design).

| # | new_line_key | collides? | outcome | Why? |
|---|---|---|---|---|
| 1 | {store, subcategory} complete | no | applied; row exists with proposed measures, others 0 | the plain path |
| 2 | {store} only | — | rejected | half a key is no identity |
| 3 | complete | yes, existing row | rejected | that line already has a budget — revise it |
| 4 | two lines, same key + same measure | self | rejected | one proposal per cell |

### BUD-R8 — Discontinue zeroes forward, never deletes · `shape: rule`

A `discontinue` change names an `effective_from` measure column; its
lines carry `line_ref` only. On approval, every measure from
`effective_from` onward (declaration order) is set to 0 and the
engine-managed `budget_discontinued` flag (added to the bound table at
first baseline, the workflow `ensureStateField` idiom) is set. Measures
before `effective_from` stand. Row deletion on an active book is always
refused (R3) — zero is an approved number; absence is amnesia.
Reinstatement is a later `revise` that clears the flag.

| # | effective_from | q1..q4 before | q1..q4 after | Why? |
|---|---|---|---|---|
| 1 | q3 | 10,20,30,40 | 10,20,0,0 | forward periods zeroed |
| 2 | q1 | 10,20,30,40 | 0,0,0,0 | immediate discontinuation |
| 3 | q9 | — | rejected | not a declared measure |
| 4 | any, line already discontinued | 10,20,0,0 | rejected | the standing periods are the wind-down yardstick — reinstate first (audit bug #2) |

### BUD-R9 — Applied changes are history · `shape: contract`

`:cancel` and `:amend` on a `submitted` budget_change are refused — the
platform's cancel would strand applied values with a cancelled paper
trail. The road back is a new opposite change. Draft changes delete
freely.

### BUD-R11 — An attached workflow owns the gate · `shape: contract`

When an active Workflow governs a table, the plain `:submit` and
`:cancel` row actions are refused **for everyone**, naming the workflow
— otherwise one generic action would sidestep every role- and
condition-gated lane the workflow defines (found live by the 2026-08-14
audit: a change over the DOA threshold submitted straight past the CFO
lane). The generic form hides its Submit/Cancel/Amend buttons on
workflow-governed tables; transitions are the only path through the
status change. Platform-wide, not budget-specific.

### BUD-R12 — Import-as-proposal: a file diffs into drafts · `shape: contract`

`POST /api/table/:table:import_proposal
{ rows, reason, dry_run?, missing_rows?, effective_from? }` — the bulk
road onto a governed table. The table must be bound by an **active**
book (otherwise refused, pointing at plain `:import` — a working book
imports freely). Rows match live rows by the book's **declared key
columns** — no key configuration in the call; the book already knows
its grain.

The diff, cell by cell over declared measures:

- a matched row's measure **present** in the file and numerically
  different → a `revise` line; equal → nothing; **absent → nothing**
  (partial files are first-class: silence is not zero);
- an unmatched file row → `new_line` lines for each present measure;
- a live row absent from the file → **nothing by default**
  (`missing_rows: 'keep'`); with `missing_rows: 'discontinue'` (and a
  required `effective_from` measure) → one `discontinue` line per
  missing row, already-discontinued rows skipped. Dropping only *some*
  missing rows is not a mode: the draft is editable — delete the lines
  to keep, approve the rest (owner ruling 2026-08-17);
- file columns neither key nor declared measure are ignored and named
  in the response, never written.

The materialization: one draft Budget Change per change_type present in
the diff (`revise` / `new_line` / `discontinue` — the header owns the
type, so a mixed file yields up to three), each carrying the call's
`reason`, each chunked at `MAX_CHANGE_LINES` keeping one row's cells in
one draft. Every draft is an ordinary draft: R4 re-snaps it, R5/R11
gate it, each approves **independently** — the response names them all
so the reviewer sees the set. Nothing touches the bound table at import
time. A zero-diff file creates nothing and says so. `dry_run: true`
computes the same report and writes nothing.

The run refuses **whole** (no partial materialization) when: any row
misses a key-column value, two rows share a key signature, a present
measure value is non-numeric, `rows` exceeds the import cap
(`MAX_ROWS = 10 000`), or `reason` is empty — a proposal is one
deliberate act, not a best-effort trickle.

| # | file row | live row | outcome | Why? |
|---|---|---|---|---|
| 1 | q2=80 | q2=100 | revise line, delta −20 | the plain diff |
| 2 | q2=100 | q2=100 | no line | equality is not a change |
| 3 | (q2 absent) | q2=100 | no line | a partial file is silent, not zero |
| 4 | key unmatched, q1=50 | — | new_line line(s) | the file speaks a new row whole |
| 5 | — | row absent from file | no line (default) | silence never discontinues |
| 6 | — | absent, `missing_rows: 'discontinue'` | discontinue line from `effective_from` | dropping is explicit, and still zeroes-forward (R8) |
| 7 | two rows, same key | — | run refused | one file, one voice per row |

**Property:** for any file and any book, approving every materialized
draft makes the bound table's declared measures equal the file's where
the file spoke and leaves them untouched where it was silent — and
`dry_run` followed by the real call reports the identical diff.

### BUD-R10 — The snapshot is the whole book · `shape: invariant`

v0 (and every later snapshot) holds one `budget_version_line` per bound
row, its `data` JSON carrying every declared key, measure, and owner
value at snapshot time. Undeclared columns are deliberately absent.

## Invariants

### BUD-I1 — The ledger reconciles

For every bound row present at baseline: **Σ current measures =
Σ v0 measures + Σ (applied change-line deltas for that row)** — row
totals, because a discontinue line's delta is deliberately one lump over
its zeroed span. Rows born from `new_line` changes reconcile from 0 at
their birth change. Verified by whole-run arithmetic over
`budget_version_line`, applied `budget_change_line`s, and the live
table.

### BUD-I2 — No half-applied change

At any commit point, a budget_change is either `draft`/`cancelled`-shaped
(no line applied) or `submitted` (every line applied). A mid-apply
failure rolls the status back with the values.

## Hazards

### BUD-H1 — The workflow side door

`applyWorkflowAction` writes status via direct UPDATE, bypassing the
submittable write-lock and (as shipped) controller hooks. If the engine
applied only on `:submit`, a workflow-approved change would flip to
`submitted` **without applying** — silently. The engine must observe the
workflow path explicitly; BUD-J3 exists to pin this. Any future change
to workflow internals must keep that seam.

### BUD-H2 — Owner drift between draft and approval

`crosses_owner` is computed at save; workflow role gates evaluate at
action time. A line whose owner changes between draft and approval can
ride a lane computed from stale facts. Accepted for M1 (owner changes on
an active book's rows are themselves locked by R3 when `owner_column` is
declared); revisit if owner edits are ever exempted.

### BUD-H3 — Two active workflows, one table

The platform does not prevent a second `is_active` Workflow on the same
table; `getActiveWorkflow` silently picks the newest. Any app or session
that activates its own workflow on `Budget Change` shadows the
governing lanes (this bit twice on 2026-08-14: an audit session's
workflow displaced the demo's). Whether the platform should enforce
one-active-per-table is the owner's call.

## Open questions

- **Q1** — overlapping pending changes on one line: block at submit, or
  rely on R5's stale-snapshot refusal alone? *Deferred by owner,
  2026-08-14; arbiter: owner.*
- **Q2** — closed-period locking (no changes to elapsed measures):
  *deferred by owner, 2026-08-14; arbiter: owner.*
- **Q3** — R3 releases the write-lock when a book closes (snapshots stay
  as history). Ratify or keep closed books locking forever? *Arbiter:
  owner.*
- **Q4** — cross-owner transfers (design §6): the engine computes
  `crosses_owner` and the demo workflow uses it to block the fast lane
  and flag the approval — but "the counterparty owner must approve"
  needs per-owner routing the workflow model cannot express per-row
  today. Enforce deeper, or is block-fast-lane + flag enough? *Arbiter:
  owner.*
- **Q5** — enforce one active Workflow per table platform-wide (BUD-H3)?
  *Arbiter: owner.*
