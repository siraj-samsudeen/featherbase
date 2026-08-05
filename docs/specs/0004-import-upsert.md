# Feature: Import Upsert (re-import on a match key)

**IDs:** `UPS-J*` journeys · `UPS-R*` rules · `UPS-I*` invariants ·
`UPS-H*` hazards · `Q*` questions
**Evidence:** `docs/specs/evidence/import-upsert.csv` (never status in this file)
**Provenance:** owner decision 2026-08-04 — IMP-R12 (graduated from the
import spec's Q2 + Q4). Second greenfield trial of the journey-spec
framework. **Spec authored before any code; the build waits on the open
questions below and on the owner's go.**

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
| J1.2 | Drop `zones-v2.csv` | The mapping step as today, **plus a Match key control**: any mapped column (or the Row ID) can be marked as the key; default is none — append-always stays the default behaviour | R1 |
| J1.3 | Mark **Zone Name** as the match key | A preview line with real counts before anything commits: "8 rows match existing rows and will be **updated**; 0 will be added" — never a silent mode switch | R2, H1 |
| J1.4 | Rehearse (the existing Check) | The same per-row report, now action-aware: each row says update / insert / failed, nothing written | R1, I1 |
| J1.5 | Click **Import** | Completion reporting updated / inserted / failed as separate counts | R1 |
| J1.6 | The Table's list | **Still 8 rows** — not 16. Alpha shows the corrected Population; every row keeps its original id | R3, I2 |
| J1.7 | Import history | The run's entry carries updated and inserted separately | R1 |

**Branch at J1.3 — no key marked.** Today's behaviour, unchanged: rows
append, the added-rows notice shows. Upsert is opt-in per run.

**Branch at J1.5 — a key collision in the file.** Rows whose key
duplicates another file row are failed and named by their true
spreadsheet row (IMP-I1 applies); the rest proceed. *(Pending Q1 — this
branch states the recommended default.)*

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
  interaction with spec 0003's R13 is Q4.
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
| duplicates another file row's key | *(Q1 — recommended: both failed, named)* | last-wins hides an authorship conflict inside one file |
| matches multiple existing rows | *(Q2 — recommended: failed, named, with the count)* | updating N rows from one line is H1's mass-overwrite in miniature |

### UPS-R3 — What an update touches · `shape: rule`

Only **mapped** columns change; unmapped database columns are untouched.
Within a mapped column, *(Q3 — recommended: an empty cell leaves the
stored value alone; clearing is an explicit act, not an absence)*. Row
identity never changes: matching on Row ID updates that row; changing an
id via upsert does not exist.

| Existing row + file row | → | Why? |
|---|---|---|
| file maps 3 of 6 columns | the other 3 keep their values | the file is authoritative only for what it maps |
| mapped cell holds a new value | value updated, full lifecycle | |
| mapped cell is empty | *(Q3)* | data loss must be chosen, not inferred |

### UPS-R4 — The file's own codes as ids · `shape: contract`

The mapping step may target the **Row ID** (the engine already accepts
explicit ids for direct sends — this closes the wizard's gap, was Q4 of
the import spec). Ids arrive verbatim (subject to the id charset the
engine enforces); the series is not consumed for supplied ids; on a Table
whose ids came from a series, mixing (some rows supplied, some series) is
allowed — the series simply continues for unsupplied rows (IMP-R6: the
pattern is the promise).

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
  rewrites many rows in a click. Mitigations in the spec: the J1.3
  preview counts before commit; rehearse shows per-row actions; updates
  run the full lifecycle (versioning records prior values); Q4 decides
  whether undo (0003's R13) covers updates. Not fully disarmed until Q4
  is ruled.

## Open questions *(arbiter: Siraj)*

| # | Question | Recommended default | Blocked on |
|---|---|---|---|
| Q1 | Duplicate key **within the file**: fail both rows (named), or last-wins? | fail both — a one-file authorship conflict should be seen, not resolved silently | — |
| Q2 | Key matches **multiple existing rows**: fail the row, or update all matches? | fail with the match count — one line updating N rows is H1 in miniature | — |
| Q3 | An **empty mapped cell** on update: leave the stored value, or clear it? | leave it — clearing is an explicit act; absence is not intent | — |
| Q4 | Does **undo** (0003 R13) cover updates? Requires recording prior values per updated row (versioning already holds them — undo could replay versions). | yes, via the version trail — else H1 keeps a leg | R13 build |
| Q5 | Is the match key **remembered per Table** (sticky default on next import) or chosen per run? | per run, sticky as a *suggestion* — remembered silently, applied loudly | — |
