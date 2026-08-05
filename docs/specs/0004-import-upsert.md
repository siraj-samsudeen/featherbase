# Feature: Import Upsert (re-import on a match key)

**IDs:** `UPS-J*` journeys · `UPS-R*` rules · `UPS-I*` invariants ·
`UPS-H*` hazards · `Q*` questions
**Evidence:** `docs/specs/evidence/import-upsert.csv` (never status in this file)
**Provenance:** owner decision 2026-08-04 — IMP-R12 (graduated from the
import spec's Q2 + Q4). Second greenfield trial of the journey-spec
framework. Spec authored before any code; **all five open questions
ruled by the arbiter 2026-08-05 — ready to build.**

## The job

UPS-J1 — "Three rows failed; I fixed them in Excel. *I'll just import the
corrected file again* — without duplicating the five that worked."

UPS-J2 — "My spreadsheet already carries our own reference codes; the
system should use them as the row ids instead of inventing a series."

## Prior state *(trial #1 finding: residue-shaped, not fixture-shaped)*

The state Spreadsheet Import leaves behind: a typed Table (the zones.csv
shape — `Journey Zones` with 8 rows, series ids, an Import Log entry) plus
a corrected variant of the same file, `zones-v2.csv`, identical except one
changed cell (Alpha's Population). The interesting input is the *pair*:
existing rows and a file that mostly matches them.

**Limits, stated on purpose:** the pair exercises clean 1:1 matching.
Hostile matching (duplicate keys, multi-matches, empty keys) lives in
UPS-R2's example table and property, not in the files.

## UPS-J1 — Re-import the corrected file *(shape: sequence)*

| # | Where / do | Must observably see | Rules |
|---|---|---|---|
| J1.1 | The existing Table's list view → **Import** | The wizard with the Table preselected (IMP-R7's entry variant, unchanged) | |
| J1.2 | Drop `zones-v2.csv` | The mapping step as today, **plus a Match key control**: any mapped column (or the Row ID) can be marked as the key; default is none — append-always stays the default. If a key was used on this Table before, it is **pre-filled as a visible suggestion** ("Match on Zone Name, as last time") — remembered silently, applied loudly, never active without being seen | R1, R5 |
| J1.3 | Mark **Zone Name** as the match key | A preview line with real counts before anything commits: "8 rows match existing rows and will be **updated**; 0 will be added" — never a silent mode switch. Beside it, the **empty-cells choice** appears (only when a key is set): "Empty cells: ◉ keep existing values · ○ clear them" — per run, defaulting to keep | R2, R3, H1 |
| J1.4 | Rehearse (the existing Check) | The same per-row report, now action-aware: each row says update / insert / failed, nothing written | R1, I1 |
| J1.5 | Click **Import** | Completion reporting updated / inserted / failed as separate counts | R1 |
| J1.6 | The Table's list | **Still 8 rows** — not 16. Alpha shows the corrected Population; every row keeps its original id | R3, I2 |
| J1.7 | Import history | The run's entry carries updated and inserted separately | R1 |

**Branch at J1.3 — no key marked.** Today's behaviour, unchanged: rows
append, the added-rows notice shows. Upsert is opt-in per run.

**Branch at J1.5 — a key collision in the file.** Rows whose key
duplicates another file row are failed and named by their true
spreadsheet row (IMP-I1 applies); the rest proceed. *(Ruled 2026-08-05,
was Q1.)*

**Isolation strategy:** self-cleaning through table deletion (spec 0003):
setup imports `zones.csv` under a journey-owned name, the journey upserts
`zones-v2.csv`, teardown deletes the Table. No skip path.

## UPS-J2 — The file's codes become the ids *(deltas from the import journeys)*

| # | Where / do | Must observably see | Rules |
|---|---|---|---|
| J2.3′ | In the mapping step (create **or** append), map a file column onto **Row ID** | The locked Row ID row accepts the mapping; the series preview is replaced by "ids come from ‹column›" | R4 |
| J2.6′ | Import | Rows carry the file's codes as their ids, verbatim; the log records the run normally | R4 |

**Branch — a file code collides with an existing id.** On append without
a match key: that row fails by its true spreadsheet row (insert-mode name
conflict, as the engine already behaves for direct sends). With the Row ID
as match key: it is an update — that is UPS-J1.

## Closure sweep

- **actors & permissions:** UPS-R1 — updating existing rows requires
  **write** permission on them, not just create; a run mixing inserts and
  updates checks both; own-rows scoping applies per row. The whole-request
  refusal pattern (IMP-R10) extends: no permission → nothing partial.
- **prior state & lifecycle:** the feature *is* prior-state-shaped; undo
  covers updates via the version trail (ruled, see H1 and IMP-R13).
- **concurrency & retries:** UPS-I3 — re-running the identical file is
  idempotent; two concurrent upserts on the same key serialize on the
  row's lock (engine behaviour, witnessed not re-specified).
- **external failures:** *(none — local operation end to end.)*
- **durability & recovery:** chunking (IMPORT_CHUNK) × matching: a key
  must resolve against the database, never against the chunk — a
  duplicate key split across two chunks must still be caught (extends the
  cross-chunk rehearsal concern already reported on C1).
- **security & privacy:** covered by the permission rule; no new surface.
- **accessibility:** the Match key control is a real labelled control in
  the mapping grid, keyboard-reachable — asserted in J1's walk.
- **performance & scale:** matching is one indexed lookup per file row on
  the key column; a key column without an index is a seq-scan per row —
  the build must state its answer (index on demand, or document the cost).
- **observability:** the Import Log gains `updated` beside inserted /
  failed; IMP-I2's per-part reconciliation extends to the new count.
- **compound hazards:** UPS-H1.

## The rules

### UPS-R1 — The import boundary learns update · `shape: contract`

`POST /api/table/:table:import` gains an optional `key_column`. Enumerated
behaviours (no example table — the rows would restate the rule):

- absent `key_column` → today's insert-only semantics, byte-for-byte;
- present → each row resolves via UPS-R2 to update / insert / fail;
- updates require write permission on the matched row; inserts require
  create; a request the caller may not fully perform is refused whole;
- the response and the Import Log carry `updated`, `inserted`, `failed`
  as separate counts (log schema gains `updated`);
- `dry_run` reports the same per-row actions and writes nothing (IMP-I3);
- updates run the full save lifecycle (hooks, validation, versioning) —
  an upsert is a saveDoc update, never a raw SQL write.

### UPS-R2 — Match resolution · `shape: rule`

**Property:** for any file and database state, every non-blank file row
resolves to exactly one action, and
`|file| = updated + inserted + failed + dropped-blank` (extends IMP-I1).

| The key cell… | → | Why? |
|---|---|---|
| matches exactly one existing row | update that row | the point of the feature |
| matches nothing | insert | upsert means the corrected file is the whole truth of itself |
| is empty | failed, named by true spreadsheet row | a row without a key cannot claim a match — silently inserting would duplicate on the next run |
| duplicates another file row's key | **both failed**, named by their true spreadsheet rows *(ruled 2026-08-05)* | last-wins hides an authorship conflict inside one file |
| matches multiple existing rows | **failed**, named, with the match count *(ruled 2026-08-05)* | updating N rows from one line is H1's mass-overwrite in miniature |

### UPS-R3 — What an update touches · `shape: rule`

Only **mapped** columns change; unmapped database columns are untouched.
Within a mapped column, empty-cell semantics are the **importing user's
explicit per-run choice** *(Q3 ruled 2026-08-05 — the arbiter's third
way)*: a control beside the match key, shown only when a key is set,
offering **keep existing values** (the default) or **clear them**.
Clearing is thereby always a chosen act — but the sparse-export wipe is
possible when chosen. Row identity never changes: matching on Row ID
updates that row; changing an id via upsert does not exist.

| Existing row + file row | → | Why? |
|---|---|---|
| file maps 3 of 6 columns | the other 3 keep their values | the file is authoritative only for what it maps |
| mapped cell holds a new value | value updated, full lifecycle | |
| mapped cell empty · choice = keep (default) | stored value survives | absence is not intent |
| mapped cell empty · choice = clear | value cleared, full lifecycle | the user said the file is the whole truth |

### UPS-R4 — The file's own codes as ids · `shape: contract`

The mapping step may target the **Row ID** (the engine already accepts
explicit ids for direct sends — this closes the wizard's gap, was Q4 of
the import spec). Ids arrive verbatim (subject to the id charset the
engine enforces); the series is not consumed for supplied ids; on a Table
whose ids came from a series, mixing (some rows supplied, some series) is
allowed — the series simply continues for unsupplied rows (IMP-R6: the
pattern is the promise).

### UPS-R5 — The key is remembered as a suggestion · `shape: contract`

*Ruled 2026-08-05 (was Q5).* The match key (and the empty-cells choice)
used on a Table's last import is stored per Table and **pre-filled as a
visible suggestion** on the next one — "Match on Zone Name, as last
time" — confirmed or changed by the user, never silently active. A run
with no key chosen stores nothing.

### Invariants · `shape: invariant`

- **UPS-I1 — reconciliation, extended.** `|file| = updated + inserted +
  failed + dropped-blank`, every failure named by true spreadsheet row
  (inherits #115's fix when it lands).
- **UPS-I2 — an upsert never deletes.** Database rows absent from the
  file are untouched, always; there is no "sync" mode.
- **UPS-I3 — idempotence.** Importing the same file with the same key
  twice leaves the database identical to once (second run: all matched,
  zero inserted, zero value changes).

### Hazards

- **UPS-H1 — the wrong key is a mass overwrite.** One bad key choice
  rewrites many rows in a click. Mitigations, all ruled: the J1.3
  preview counts before commit; rehearse shows per-row actions; updates
  run the full lifecycle so versioning records prior values; and undo
  **covers updates by replaying the version trail** *(Q4 ruled
  2026-08-05 — an R13 build requirement, cross-noted in the framework's
  IMP-R13)*. Fully disarmed once R13 ships; until then the version
  history UI is the manual recovery path.

## Open questions *(arbiter: Siraj)*

None open. *All five ruled 2026-08-05:* Q1 → R2 (duplicate file keys:
both failed, named) · Q2 → R2 (multi-match: failed with the count) ·
Q3 → R3 (empty cells: the importing user's explicit per-run choice,
default keep — the arbiter's third way, better than either drafted
option) · Q4 → H1 + framework IMP-R13 (undo covers updates via the
version trail) · Q5 → R5 (the key is remembered as a visible
suggestion). Per the change protocol the questions live on as rules.
