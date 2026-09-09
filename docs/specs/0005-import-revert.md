# Feature: Import Revert (undo a run, row by row)

**IDs:** `RVT-J*` journeys · `RVT-R*` rules · `RVT-I*` invariants ·
`RVT-H*` hazards · `Q*` questions
**Evidence:** a `> evidence:` verdict under each obligation below;
linkage checked by `tools/check-evidence.mjs`
**Provenance:** owner decision 2026-08-11 — UPS-H1's fourth mitigation
("undo covers updates via the version trail"), pulled forward for the
first real-data deployment. Three rulings made 2026-08-11, before
authoring: revert defaults to **skipping rows edited after the import**,
reported by name; an explicit **"revert these N anyway"** escalation
covers the skipped rows; refusing entirely is just not proceeding — there
is no third mode. The wizard sequence this feature rides in is
[spec 0008](0008-spreadsheet-import.md) (IMP-J5.5 and IMP-J7.5).

## The job

RVT-J1 — "I picked the wrong match key and rewrote 1,200 rows. *Put them
back the way they were* — without losing the edits people made since."

## Prior state *(residue-shaped)*

The state spec 0004 leaves behind: a Table whose rows were written by an
import run — some inserted, some updated (each update leaving a version
row with before-values, because `track_changes` defaults on) — and an
Import Log entry per part carrying the run's counts and choices.

**What the log does NOT yet carry — the build's first obligation:** a run
identity shared by its parts, and the list of rows each part wrote. RVT-R1
adds both.

**Limits, stated on purpose:** imports write flat columns only (the wizard
maps no sub-table columns), so revert never has child rows to consider. A
Table with `track_changes` off has no before-values to restore — RVT-R3
names that outcome rather than pretending.

## RVT-J1 — Revert the bad run *(shape: sequence)*

> evidence: proven — the full walk via the history strip (J1.1's second
> entry point): rehearsal counts before commit, the edited row skipped
> and NAMED, the run's insert deleted, the bystander untouched, the
> escalation restoring the run's before-value while the later edit loses
> by explicit choice, and the log recording the revert. Caveat: the
> completion-panel variant renders the SAME `RevertControl` but was not
> separately walked — single-sheet imports auto-navigate away, which is
> the ratified IMP/UPS walk.

| # | Where / do | Must observably see | Rules |
|---|---|---|---|
| J1.1 | The wizard's completion panel (or the run's entry in the history strip) → **Revert this run** | A rehearsal BEFORE anything commits: "will restore N updated rows, delete M added rows; K skipped (edited after this import), L skipped (no longer present)" — counts from a dry run, nothing written | R2, R4, H1 |
| J1.2 | Confirm **Revert** | Completion reporting restored / deleted / skipped as separate counts; every skipped row named with its reason, by Row ID | R2, R4 |
| J1.3 | The Table's list | Updated rows carry their pre-import values again; the run's inserted rows are gone; rows the run never touched are byte-identical | R2, I1, I2 |
| J1.4 | The skipped report → **Revert these K anyway** | A second, explicitly chosen pass over ONLY the named skipped rows; the same completion shape. Destruction is always a chosen act | R5 |
| J1.5 | Import history | The run's entry shows it was reverted (and when); the revert itself is versioned — every restore is a full-lifecycle update, so the trail records it | R2, I3 |

**Branch at J1.1 — nothing revertable.** Every touched row was since
edited or deleted: the rehearsal says so, the Revert button stays
enabled only for the override path (J1.4's escalation, offered directly).

**Isolation strategy:** self-cleaning through table deletion (spec 0003):
setup imports a fixture under a journey-owned name, upserts a corrupted
variant, reverts, teardown deletes the Table. No skip path.

## Closure sweep

- **actors & permissions:** RVT-R6 — restoring a row needs **write** on
  it; deleting an inserted row needs **delete**; the whole-request refusal
  pattern (IMP-R10, UPS-R1) applies: a caller who cannot fully perform the
  requested revert (including the override list) gets nothing partial.
- **prior state & lifecycle:** the feature *is* reversal; reverting a
  revert is just another revert of the newer "run" — out of scope as a
  distinct feature, possible via version history.
- **concurrency & retries:** stamps arbitrate — a row edited between
  rehearsal and commit fails its stamp check and lands in skipped, never
  silently overwritten (RVT-R4's mechanism is the guard).
- **external failures:** *(none — local end to end.)*
- **durability & recovery:** revert runs row-by-row through the full save
  lifecycle; a run interrupted midway leaves reverted rows reverted and
  the rest untouched — re-running the revert skips the already-restored
  (their stamps moved) and continues; the completion counts reconcile
  (RVT-I1).
- **security & privacy:** covered by the permission rule; no new surface.
- **accessibility:** the revert control and its confirmation are labelled,
  keyboard-reachable controls — asserted in J1's walk.
- **performance & scale:** one version-row lookup + one saveDoc per
  reverted row; a 10k-row revert is 10k lifecycle updates by design —
  correctness over speed, stated here on purpose.
- **observability:** the run's log entry records the revert (RVT-R2's
  response counts land there); the version trail records every restore.
- **compound hazards:** RVT-H1.

## The rules

### RVT-R1 — A run becomes addressable · `shape: contract`

> evidence: proven — log rows carry `run_id` plus the touched rows
> (`name`, action, stamp, and a version pointer set exactly when a
> version row was born in that request); dry runs record nothing, so
> IMP-I3 is intact.

The import boundary (`POST /api/table/:table:import`) learns to record,
per part row in the Import Log:

- a **`run_id`** shared by all the run's parts (minted by the wizard,
  carried in the existing `context`);
- the list of rows the part wrote: for each, its Row ID, its action
  (`updated` | `inserted`), and the `updated_at` stamp the write left.

Keyless and keyed runs both record this. A dry run records nothing
(IMP-I3 untouched). The wizard's existing runs predate `run_id`; their
log rows have none and are simply not revertable — no backfill.

### RVT-R2 — The revert boundary · `shape: contract`

> evidence: proven — `dry_run` reports the plan and writes nothing; an
> unknown `run_id` 404s; an override naming an unwritten row 417s;
> resolution spans all of a run's parts; `reverted_at` is recorded.

`POST /api/table/:table:import-revert` with `{ run_id }`, plus optional
`{ dry_run: true }` and `{ override: [row ids] }`. Behaviours:

- resolves every row the run's parts recorded, across ALL parts;
- per row, RVT-R4 decides restore / delete / skip; `override` names rows
  whose skip (edited-after only) is overridden — a name outside the run's
  recorded rows is a validation error;
- `dry_run` reports the same per-row decisions and writes nothing;
- the response carries `restored`, `deleted`, `skipped` (each skip named
  with its row id and reason), `failed` (a restore/delete that errored,
  named); the log entry gains the revert outcome;
- restores and deletes run the **full save lifecycle** — a revert is
  saveDoc updates and deleteDoc deletes, never raw SQL;
- an unknown `run_id`, or one whose log rows carry no recorded rows
  (pre-feature runs), refuses whole with a message saying why.

### RVT-R3 — What a restore restores · `shape: rule`

> evidence: proven at the contract tier for restore / unchanged /
> already-gone / row-deleted. Caveat: **rule-tier only** for
> no-version-trail — the API offers no way to set `track_changes: false`
> today, so that state is unreachable end to end and is proven against
> the exported pure `planRevert`; flagged as a discovered gap in the PR.

**Property:** after reverting an unedited-since run on a `track_changes`
Table, every updated row's mapped columns equal their pre-import values,
and columns the import never touched are untouched.

| The touched row… | → | Why? |
|---|---|---|
| was updated; version row from this run exists | restore that version's before-values via a lifecycle update | the point of the feature |
| was updated; no version row (the update was a no-op) | nothing to restore — counted `skipped: unchanged` | recordVersion skips no-ops; honesty over motion |
| was updated; Table has `track_changes` off | `skipped: no-version-trail`, named | no before-values exist; pretending would fabricate data |
| was inserted | delete via the lifecycle (references may refuse → `failed`, named) | the run created it; the run's undo removes it |
| was inserted; since deleted | `skipped: already-gone` | the desired end state already holds |

### RVT-R4 — Edited-after detection · `shape: rule`

> evidence: proven — a matching stamp proceeds, an edited-after row is
> skipped and named, the override wins on a second act and the
> destroyed edit is itself versioned; the concurrent-edit window is
> closed by `expectUpdatedAt` / `updated_at` optimistic stamps at write
> time.

*Ruled 2026-08-11.* A touched row's recorded `updated_at` stamp is
compared to its current value: equal → the import was the last writer,
revert proceeds; different → someone edited after the import →
**`skipped: edited-after`, named by Row ID** — unless the row is in
`override`, in which case the revert wins and the later edit is lost
(itself recorded in the version trail, so nothing is unrecoverable).

| Stamp vs current | override? | → |
|---|---|---|
| equal | — | proceed (restore or delete per R3) |
| differs | not listed | skipped: edited-after, named |
| differs | listed | proceed; the later edit loses, versioned |
| row gone (was updated) | — | skipped: row-deleted, named |

### RVT-R5 — The override is a second, explicit act · `shape: contract`

> evidence: proven via RVT-J1, RVT-R4 — the escalation exists only after
> a report naming the skips, and sends `override` with exactly those
> names; no force-everything control is rendered on the first pass. The
> proof rides inside the browser walk and RVT-R4's override case rather
> than a test of its own.

The wizard's completion report offers "Revert these K anyway" ONLY after
a revert reported skips, listing the K rows by id and reason; choosing it
issues a second `:import-revert` with `override` naming exactly those
rows. There is no "force everything" flag on the first pass.

### RVT-R6 — Permissions · `shape: contract`

> evidence: proven — a write-only caller facing a run that contains
> deletes is refused whole (403) with nothing written, the restorable
> rows included; write-scope restores are exercised throughout by admin
> runs.

Restores check **write** per row; deletes of inserted rows check
**delete**; own-rows scoping applies per row (against the row's current
creator). Any refusal refuses the request whole, before any write —
including rows named in `override`.

### Invariants · `shape: invariant`

- **RVT-I1 — reconciliation.** `|rows the run recorded| = restored +
  deleted + skipped + failed`, every skip and failure named by Row ID.

  > evidence: proven — the arithmetic is asserted on mixed runs and
  > every skip is named with its row id and reason.

- **RVT-I2 — a revert touches only what the run touched.** Rows absent
  from the run's record are byte-identical after a revert, always —
  including rows matched but failed by the original run. A revert never
  deletes a Table, even when the run created it (`table_created` is not
  an invitation; Table deletion is spec 0003's, a separate chosen act).

  > evidence: proven — bystander rows are byte-identical (`updated_at`
  > included) after a revert, and no Table-deletion surface exists in
  > the action at all (ruled 2026-08-11).

- **RVT-I3 — a second identical revert is a no-op.** The first revert
  moved every restored row's stamp; the second finds no stamp matches and
  skips everything — zero writes, and the report says so.

  > evidence: proven — the second revert restores zero and deletes zero,
  > names every skip (edited-after for the restored rows, whose stamps
  > moved, and already-gone for the deleted ones), and leaves the table
  > state identical.

### Hazards

- **RVT-H1 — the override is a mass overwrite in miniature.** UPS-H1's
  shape again, one level up: overriding K skipped rows destroys K later
  edits in a click. Mitigations: the override exists only as a second
  explicit act over named rows (R5); each destroyed edit is itself
  versioned (R2's full lifecycle), so the version history UI remains the
  recovery path; the rehearsal names every row before commit.

  > evidence: proven via RVT-R4, RVT-J1 — closed (R5 carries no test
  > title of its own; it rides the same two, see its verdict). The override
  > exists only as a second explicit act over named rows; each destroyed
  > edit is versioned (the overridden edit was recoverable in the
  > trail); the rehearsal names every row before commit.

## Open questions *(arbiter: Siraj)*

None open. The three 2026-08-11 rulings are baked into R4/R5 (skip
default, explicit override, no third mode), and the two agent-drafted
calls were **ratified by the arbiter 2026-08-11 at spec review**: R6
derives who-may-revert purely from row permissions (no importer-only
restriction), and RVT-I2's "revert never deletes a Table" stands,
mirroring UPS-I2.
