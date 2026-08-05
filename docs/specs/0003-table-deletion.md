# Feature: Table Deletion

**IDs:** `DEL-J*` journeys · `DEL-R*` rules · `DEL-I*` invariants ·
`DEL-H*` hazards · `Q*` questions
**Evidence:** `docs/specs/evidence/table-deletion.csv` (never status in this file)
**Provenance:** owner decision 2026-08-04 (hermeticity, adoption item 9 in
`docs/design/requirements-framework.md`); GitHub issue #118. First
greenfield trial of the journey-spec framework.

## The job

DEL-J1 — "I built a table as an experiment (or an import created one I
didn't want) and I need it gone — completely, not hidden."

DEL-J2 — "I tried to delete a table and the system said no; I need to
know exactly what is standing in the way, undo that, and try again."

## The fixture — `zones.csv` (reused)

The same eight-row, six-column agreement dataset as Spreadsheet Import
(`apps/web/e2e/fixtures/zones.csv` + its claims file): importing it
creates a typed `Journey Zones`-style Table with rows, an Import Log
entry, a permission row, and a home-page link — exactly the residue
deletion must remove. Reusing it makes the deletion journey the natural
epilogue of the import journey, which is the hermeticity story this
feature exists to serve.

**Limits, stated on purpose:** the fixture exercises the *sidecar* space
only as far as an import populates it. Sidecars an import never writes
(shares, saved views, workflows…) are covered by DEL-R4's property, not
by this file.

## DEL-J1 — Delete an unwanted Table *(shape: sequence)*

| # | Where / do | Must observably see | Rules |
|---|---|---|---|
| J1.1 | The unwanted Table's list view, signed in as a System Manager | The manager button row contains **Delete Table** alongside Naming and Permissions, styled as the destructive action | R1 |
| J1.2 | Click **Delete Table** | A confirmation naming the Table and its **live row count** ("Delete Journey Zones? 8 rows will be permanently deleted. This cannot be undone.") — never a bare "are you sure" | H1 |
| J1.3 | Confirm | Landed on **All tables**; the deleted Table absent from every module group | R2 |
| J1.4 | Navigate to the deleted Table's list URL directly | A not-found that **names the deletion** — "Journey Zones was deleted by Administrator on 2026-08-04" — never a bare error, never an empty list | R2, R9 |
| J1.5 | Open the **Import Log** list | No entry names the deleted Table | R4 |

**Branch at J1.2 — cancel.** Dismiss the confirmation: the list view is
still there, untouched; row count unchanged. *(→ I2)*

**Branch at J1.1 — not a manager.** A signed-in non-manager sees the
button row without Delete Table (positive complement: the row holds
exactly the view buttons their role earns); a direct API call is refused
whole-request. *(→ R1)*

**Isolation strategy:** self-cleaning by construction — the journey
creates its Table (import of `zones.csv` under a journey-owned name) and
ends by deleting it, so re-runs meet a clean database. No skip path
exists; this journey is the one that retires the import journeys' skips.

## DEL-J2 — Refused, unblocked, deleted *(deltas from J1 only)*

| # | Where / do | Must observably see | Rules |
|---|---|---|---|
| J2.2′ | Confirm deletion of a Table that another Table references | A refusal **naming the referencing Table and column** ("Cannot delete Journey Zones: Journey Bookings.zone references it") — the Table still present, all rows intact | R3, I2 |
| J2.3′ | Remove the referencing column (or delete the referencing Table), retry | Deletion now succeeds as J1.3–J1.5 | R3 |

**Isolation strategy:** the referencing pair is created via the API in
setup under journey-owned names; teardown deletes the referrer then the
referent — the refusal path itself proves teardown order matters.

## Closure sweep

- **actors & permissions:** DEL-R1 — System Manager only, refusal is
  whole-request; the UI affordance is absent, not disabled, for others.
- **prior state & lifecycle (incl. reversal):** DEL-H1 — deletion is
  irreversible; there is no recycle bin. IMP-R13's import *undo* is
  row-level and dies with the table — the two vocabularies (row-level
  reverse vs table-level deletion) are kept deliberately distinct.
  Import Log rows for the table are swept (DEL-R4): a live pointer never
  outlives its target; the Access Log's plain-text trail survives as the
  durable history (DEL-R8), and stale pointers that arrive later get its
  testimony back as a tombstone (DEL-R9).
- **concurrency & retries:** DEL-I2 — the operation is one transaction;
  a concurrent second delete of the same Table gets not-found; a retry
  after refusal is a fresh evaluation, not a queued intent.
- **external-dependency failure:** DEL-R6 — deleting a bound Table
  drops only the local binding, never source storage; it succeeds even
  when the source is unreachable.
- **durability & recovery:** DEL-R5 — series counters survive deletion
  (IMP-R6: the pattern is the promise, not the number); DEL-R7 —
  attachment registry rows go with the table, their bytes are removed
  best-effort and are unreachable regardless (registry-only serving).
- **security & privacy:** the physical table's RLS policies drop with
  the table (nothing to leak); File registry sweep (R7) keeps private
  uploads unreachable. Covered by R2/R7 — no separate ID.
- **accessibility:** the confirmation is a real dialog: labelled,
  keyboard-dismissable, confirm/cancel reachable by tab. Asserted in
  J1's browser walk, no separate ID.
- **performance & scale:** *(none — DROP TABLE is O(1) DDL; the sidecar
  sweep is one indexed delete per declaring column, a fixed set (~20)
  derived from metadata, independent of row volume.)*
- **observability:** DEL-R8 — the deletion writes an Access Log entry
  (who, which table, when) in plain text, which the sweep deliberately
  does not touch.
- **compound hazards:** DEL-H1.

## The rules

### DEL-R1 — Who may delete · `shape: contract`

Deleting a Table requires the same authority as creating one: System
Manager. Refusal is whole-request — nothing partial, nothing logged as
done. The UI affordance renders only for managers; its absence for
others is asserted as a positive complement (the button row contains
exactly the earned buttons), never a bare zero-count.

### DEL-R2 — Deletion removes what creation wrote · `shape: contract`

The deletion operation (`DELETE /api/doctype/:name`) reverses table
creation in one transaction: the Table's definition row, its column
definitions, its physical table with **all rows**, and its own
sub-table *rows* (children whose parent kind is the deleted Table).
A `settings`-kind Table, which never had a physical table, sheds
metadata only. The sub-table *Table definition* is not cascaded — it
may serve other parents and is deleted on its own (R3 guards it while
referenced).

| The Table being deleted | Removed | Kept |
|---|---|---|
| Ordinary, 8 rows, one Sub-table column | def row, column defs, physical table + 8 rows, its child *rows* | the child sub-table's own definition |
| `settings` kind | def row, column defs | — (no physical table existed) |
| nonexistent name | rejected — not found | everything |

### DEL-R3 — Schema references block, and say who · `shape: rule`

The reverse-lookup that blocks row deletion (DOC-006) applies one level
up: if any *other* Table's schema targets this one — a Reference column
aiming at it, or a Sub-table column using it as row storage — deletion
is refused with a message naming every blocking Table and column. The
check is schema-level: it blocks even with zero data rows, because the
reference's existence is the dependency.

**Property:** for any set of Table definitions, deletion of X is refused
iff some Table Y ≠ X has a column with `reference_table = X` or
`row_table = X`; the refusal message contains every such `Y.column`.

| Situation | → | Why? |
|---|---|---|
| Bookings.zone is a Reference to Zones | rejected, names `Bookings.zone` | the schema depends on Zones existing |
| PO has Sub-table column with row_table = PO Line; delete PO Line | rejected, names `PO.items` | PO's rows store children there |
| Zones references only itself (`amended_from`) | deletable | a self-reference dies with the table |
| Bookings.zone exists but Bookings has no rows | still rejected | the dependency is the column, not the data |
| `system` Table (User, Permission, …) | rejected — system tables are platform anatomy | the app cannot run without them |
| Table / Column (the engine's own definitions) | rejected | engine-managed; deleting the definition of definitions is nonsense |

### DEL-R4 — The sidecar sweep · `shape: rule`

Everything that points at the Table through a live pointer goes with it,
in the same transaction. "Live pointer" is defined by metadata, not by a
hand-kept list: every column anywhere declared as `Reference → Table`
(permission rows, Import Log entries, File registry rows, home-page
links, shares, scripts, …) has its matching rows deleted. Plain-text
mentions — columns typed `Data` that happen to hold a table name, like
the Access Log's — are **not** pointers and survive as history.

**Property:** after deleting X, no row in any table holds X in a column
whose type is `Reference → Table`; rows in tables with no such column
are untouched.

| After deleting Journey Zones… | → | Why? |
|---|---|---|
| its Permission rows | gone | dead grants are a security smell |
| its Import Log entries | gone | a log row's Reference would dangle; table-level deletion supersedes row-level undo (IMP-R13) |
| its home-page link | gone | navigation must not offer a dead door |
| an Access Log line naming it | **kept** | plain text is testimony, not a pointer |
| another Table's rows generally | untouched | the sweep reaches only declared pointers |

### DEL-R5 — Row-id series survive · `shape: rule`

Cross-ref IMP-R6: the pattern is the promise, not the number. Deleting a
Table burns nothing and resets nothing — recreate a Table with the same
name and its ids continue from wherever the global counter stands.

| Do | → ids |
|---|---|
| Import Zones (fresh counter) | `ZONES-001 … ZONES-008` |
| Delete Zones, import the same file again | `ZONES-009 … ZONES-016` — never `-001` again |

**Property:** for any sequence of create/delete cycles of the same
name, issued ids never repeat.

### DEL-R6 — A bound Table sheds its binding, never its source · `shape: contract`

Deleting a Table bound to an external Data Source removes the binding
(definition + column defs + sidecars) and issues **no DDL against the
source** — BV1 holds at deletion exactly as at creation. Because the
operation is local-only, it succeeds even when the source is
unreachable.

### DEL-R7 — Attachments · `shape: rule`

File registry rows referencing the Table are swept by R4 — which alone
makes the bytes unreachable, since files are only ever served through a
registry lookup. The stored bytes themselves are removed after commit,
best-effort: a byte that survives an unlink failure is disk garbage,
not a data leak.

### DEL-R8 — The deletion is logged, in text · `shape: contract`

Every successful deletion writes an Access Log entry — who, which
table, when — using plain-text columns, so the record outlives its
subject (R4 deliberately cannot reach it).

### DEL-R9 — A stale pointer gets a tombstone, not a shrug · `shape: contract`

*Graduated from Q2, decided by the arbiter 2026-08-04.* Asking for a
Table that was deleted answers with the deletion itself: the not-found
carries "*X was deleted by 〈user〉 on 〈date〉*", read back from R8's
testimony at the moment of the miss. A Table that never existed stays a
plain "not found" — a tombstone is only ever minted from a real burial.
Every surface that resolves a Table by name (deep link, Recents entry,
list URL) inherits the message through the same boundary; client-side
Recents entries themselves are localStorage and age out on their own.

| Ask for | → | Why? |
|---|---|---|
| a Table deleted yesterday | not-found: "X was deleted by Administrator on 2026-08-04" | the fact is known; say it |
| a name that never existed | not-found: "Table X not found" | no burial, no tombstone |
| a Table deleted twice under one name (created again between) | the **latest** deletion's line | the newest fact is the operative one |

### Invariants · `shape: invariant`

- **DEL-I1 — nothing dangles.** After a successful deletion of X:
  zero `column_def` rows target X (own, reference, or row-storage),
  zero rows anywhere hold X in a `Reference → Table` column, and no
  physical table for X exists. The count of rows in every *other*
  physical table changes only by its declared pointer rows (R4) and
  child rows (R2).
- **DEL-I2 — a refusal changes nothing.** Any refused or failed
  deletion leaves every table, row count, and sidecar exactly as
  before — the operation is one transaction with no partial outcome.

### Hazards

- **DEL-H1 — irreversible × one click × generic UI.** Deletion cannot
  be undone, the affordance appears on every Table's list view, and the
  platform has no backup story yet. No single rule owns the compound.
  Mitigations in force: R1 (managers only), J1.2 (the confirmation
  carries the live row count and says "cannot be undone"), R8 (the
  audit line survives). Residual risk accepted at this project stage;
  revisit at first deployment. *(Stronger confirmation → Q1.)*

## Open questions *(arbiter: Siraj)*

| # | Question | Blocked on |
|---|---|---|
| Q1 | Should populated Tables demand typed-name confirmation (GitHub-style) instead of a counted confirm dialog? Shipped default: counted dialog. | — |
| Q3 | **Archive vs delete.** Should any Table support archive/inactive semantics (soft delete: rows or whole Tables hidden but recoverable) *alongside* hard deletion? The hermeticity decision deliberately chose hard delete + swept pointers + text testimony; an archive tier would be a separate capability with its own journeys, not a variant of this one. | — |

*Graduated 2026-08-04 by the arbiter:* Q2 (tombstone messaging) → R9.
Per the change protocol the question is removed and the answer lives as
a rule.

## Retrospective — where the journey-spec format chafed (trial #1)

Written after building and proving every row; the point of the trial
(issue #118). The spec was authored before any code and survived the
build with **zero rule changes** — every edit after building was
additive (two owner-raised open questions and this section).

1. **The fixture section wants to be optional.** Import genuinely has an
   agreement dataset; deletion's "fixture" is *residue* — the interesting
   input is the state left by another feature, not a file. Reusing
   zones.csv was honest, but the section header fought the content: a
   "prior state" slot would have fit better than a "fixture" slot.
2. **Contract-shaped rules dominate; example tables felt thin for them.**
   R2/R6/R8 are contracts whose "example table" is really just the rule
   restated in rows. The example-table discipline earns its keep on R3/R4
   (genuine value variation); for contracts the framework could bless
   "no table — enumerate behaviours" explicitly, as C1 already does in
   the import spec.
3. **The closure sweep was the highest-value section per minute.** It
   forced the Access-Log-survives / Import-Log-swept distinction (live
   pointer vs testimony), the bound-table line, and the series-survival
   cross-ref — none of which the journeys alone would have surfaced.
   Keep it mandatory.
4. **Sub-ID pressure appeared immediately.** J1's two branches and R3's
   six rows each wanted citation from tests; positional steps (J1.2)
   worked, but the evidence CSV wants one row per *proof*, and a single
   R3 row hides six distinct refusal proofs. Minted no sub-IDs (nothing
   external cites one yet) — the emergent-ID rule held, but the tension
   between "one row per obligation" and grouped rules is real; expect
   sub-IDs the first time one refusal regresses alone.
5. **"No implementation detail" vs contracts naming routes.** §11 bans
   routes from the spec body while the exemplar's C1 names its route.
   Followed the exemplar (R2 names `DELETE /api/doctype/:name`) — a
   contract without its address isn't one. The framework should say so.
6. **Text-addressed DSL verbs collide on nested affordances.** The
   dialog's confirm button ("Delete") sits under the page button
   ("Delete Table"); `clickButton('Delete')` is ambiguous, so the
   confirm click fell back to a `step()` with a test-id locator. Not a
   spec problem — but journeys that open dialogs will hit it every
   time; the DSL wants a `within()`-scoped click for it.
7. **The open-questions section earned its keep mid-build.** The owner
   raised the stale-Recents/tombstone question while the build was in
   flight; it landed as Q2/Q3 without touching a single rule, and Q2 was
   ruled on and graduated into R9 the same day — the full
   question→decision→rule cycle inside one feature, with nothing
   resolved silently in code.
8. **What worked without friction:** step triples translated 1:1 into
   the feather-testing DSL; the isolation-strategy slot made J1's
   self-cleaning design a *requirement* rather than an afterthought
   (both journeys pre-clean *through the capability under test*); the
   evidence CSV's verdict vocabulary (`conditionally-proven` → `proven`
   for IMP-J1) recorded the hermeticity payoff in exactly the right
   place.
