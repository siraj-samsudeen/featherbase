# Table Deletion

## Purpose

Deleting a Table outright: what goes with it, what blocks it, what survives it as
testimony, and what a later reader of a dead link is told. Hermeticity is the job —
"I built a table as an experiment and I need it gone, completely, not hidden" — which
is why the sidecar sweep and the tombstone are part of the capability rather than
follow-on work.

Migrated from `docs/specs/0003-table-deletion.md` (owner decision 2026-08-04, issue
#118, the first greenfield trial of the journey-spec framework) as the worked example
for issue #226's OpenSpec evaluation. **The journey-spec is still the live document**;
this is a faithful re-expression of it for comparison, not a replacement. What the two
forms carry, and what this migration lost, is recorded in
`docs/design/openspec-vs-journey-spec.md`.

Legacy IDs (`DEL-J1`, `DEL-R3`, …) are recorded per requirement because code comments,
test titles and PR discussions already cite them; a migration that broke those
citations would be a rename with no upside.

## Domain assumptions

Facts about a world this capability does not control. Each is a **D** in `S ∧ D ⟹ R`:
when one is false the code can be correct and the requirement still violated. None of
these can be unit-tested — there is no branch — so each names what would detect its
violation instead.

### Assumption: drop_table_is_atomic_with_the_metadata_delete
- **Assumption:** `drop table` participates in the same Postgres transaction as the
  `table_def` / `column_def` deletes, so a failure anywhere in the block leaves both
  the physical table and its definition intact.
- **Established by:** Postgres implements transactional DDL; the deletion issues the
  drop inside `sql.begin` (`apps/server/src/table-engine.ts`, `deleteTable`).
- **When:** Postgres 17, the version CI and `init.sh` both run.
- **Detected by:** `DEL-I2`'s row-count comparison after a blocked delete — but only
  for the *blocked* path. A partial commit on the success path would be detected by
  nothing today.

### Assumption: unlinked_bytes_are_unreachable_anyway
- **Assumption:** stored file bytes are only ever served through a `file` registry
  lookup, so sweeping the registry row makes the bytes unreachable whether or not the
  unlink succeeds.
- **Established by:** the signed-file serving path (`apps/server/src/storage.ts`;
  `apps/server/test/signed-files.test.ts`).
- **When:** 2026-08-04, re-read 2026-09-18.
- **Detected by:** nothing in this capability. It is the reason `DEL-R7` may be
  best-effort; if a direct-serving path were ever added, this requirement silently
  becomes a data leak rather than disk garbage.

### Assumption: recents_entries_age_out_on_their_own
- **Assumption:** a client's Recents list is `localStorage` and expires without server
  involvement, so a deleted Table's entry is a stale pointer that the tombstone
  (`DEL-R9`) answers rather than something the sweep must reach.
- **Established by:** `apps/web/src/lib/recents.ts`.
- **When:** 2026-08-04.
- **Detected by:** nothing — a Recents entry that outlived its ageing would present a
  dead door, answered only by the tombstone message.

## State tables

### Who blocks a deletion (evaluated in this order; the first match decides)

`DEL-R3`'s six prose rows, tabulated. Complete over its input space and disjoint —
which is the property prose cannot be checked for.

| The Table | Some other Table's column targets it | It is `system` | It is `Table`/`Column` | → | Message names |
|---|---|---|---|---|---|
| ordinary | no | no | no | deleted | — |
| ordinary | `reference_table = X` | no | no | refused | every `Y.column` |
| ordinary | `row_table = X` (Sub-table storage) | no | no | refused | every `Y.column` |
| ordinary | only its own columns (`amended_from`) | no | no | deleted | — |
| system (`User`, `Permission`, …) | any | yes | no | refused | the system-table refusal |
| the engine's own definitions | any | yes | yes | refused | the system-table refusal |

### What a deletion removes, by kind

| Kind | Definition row + column defs | Physical table + rows | Its own child *rows* | The child Table's definition | Source storage |
|---|---|---|---|---|---|
| ordinary | removed | removed | removed | kept | n/a |
| `settings` | removed | never existed | n/a | n/a | n/a |
| source-bound | removed | never existed locally | n/a | n/a | **untouched** |
| nonexistent name | rejected — not found | — | — | — | — |

## Requirements

### Requirement: system_manager_only
Deleting a Table SHALL require System Manager authority — the same authority creating
one requires. Refusal SHALL be whole-request: nothing partial, nothing logged as done.
The Admin affordance SHALL render only for managers, and its absence for others SHALL
be asserted as a positive complement (the button row holds exactly the buttons the role
earns), never as a bare zero-count.

#### Scenario: non_manager_refused
- **WHEN** a signed-in non-manager calls the deletion endpoint
- **THEN** the request is refused whole and the Table, its rows and its sidecars are
  exactly as before.

### Requirement: deletion_reverses_creation
`DELETE /api/table_def/:name` SHALL reverse table creation in one transaction: the
Table's definition row, its column definitions, its physical table with **all rows**,
and the rows its Sub-table columns store. A `settings`-kind Table, which never had a
physical table, SHALL shed metadata only. The sub-table's own *Table definition* SHALL
NOT be cascaded — it may serve other parents, and `schema_reference_blocks` guards it
while referenced.

#### Scenario: child_rows_go_child_definition_stays
- **WHEN** an ordinary Table with one Sub-table column and eight rows is deleted
- **THEN** its definition, column definitions, physical table, rows and child rows are
  gone, and the child sub-table's own definition remains.

#### Scenario: settings_table_sheds_metadata_only
- **WHEN** a `settings`-kind Table is deleted
- **THEN** its definition and column definitions go and no physical table is dropped.

#### Scenario: nonexistent_name_is_not_found
- **WHEN** a name no Table has is deleted
- **THEN** the request is rejected as not found and nothing changes.

### Requirement: schema_reference_blocks
If any *other* Table's schema targets this one — a `Reference` column aiming at it, or
a `Sub-table` column using it as row storage — deletion SHALL be refused with a message
naming **every** blocking `Table.column`. The check SHALL be schema-level: it SHALL
block even when the referencing Table holds zero rows, because the reference's existence
is the dependency. A Table's references to itself SHALL NOT block. System Tables and the
engine's own `Table`/`Column` definitions SHALL be refused outright.

**Property:** for any set of Table definitions, deletion of X is refused iff some Table
Y ≠ X has a column with `reference_table = X` or `row_table = X`; the refusal message
contains every such `Y.column`.

#### Scenario: zero_rows_still_blocks
- **WHEN** `Bookings.zone` references `Zones` and `Bookings` holds no rows
- **THEN** deleting `Zones` is refused and the message names `Bookings.zone`.

#### Scenario: sub_table_storage_blocks
- **WHEN** `PO.items` stores its rows in `PO Line`
- **THEN** deleting `PO Line` is refused and the message names `PO.items`.

#### Scenario: self_reference_never_blocks
- **WHEN** the only column targeting `Zones` is `Zones.amended_from`
- **THEN** `Zones` is deletable — a self-reference dies with the table.

#### Scenario: system_tables_refused
- **WHEN** `User`, `Permission`, `Table` or `Column` is the target
- **THEN** deletion is refused: they are platform anatomy.

### Requirement: live_pointer_sweep
Everything that points at the Table through a **live pointer** SHALL be removed in the
same transaction, and "live pointer" SHALL be defined by metadata rather than a
hand-kept list: every column anywhere declared `Reference → Table` — permission rows,
Import Log entries, File registry rows, home-page links, shares, scripts — has its
matching rows deleted. Plain-text mentions (columns typed `Data` that merely hold a
Table's name, such as the Access Log's) are **not** pointers and SHALL survive as
history.

**Property:** after deleting X, no row in any table holds X in a column whose type is
`Reference → Table`; rows in tables with no such column are untouched.

#### Scenario: declared_pointers_go
- **WHEN** a Table with permission rows, an Import Log entry and a home-page link is
  deleted
- **THEN** all three are gone, because each lives in a column declared
  `Reference → Table`.

#### Scenario: plain_text_testimony_survives
- **WHEN** the Access Log holds a line naming the deleted Table in a `Data` column
- **THEN** that line survives: plain text is testimony, not a pointer.

### Requirement: id_series_survive_deletion
Deleting a Table SHALL neither burn nor reset its id-pattern counter. Recreating a Table
with the same name SHALL continue issuing ids from wherever the global counter stands.

**Property:** across any sequence of create/delete cycles of the same name, issued ids
never repeat.

#### Scenario: ids_continue_after_recreate
- **WHEN** `Zones` is imported (`ZONES-001…008`), deleted, and the same file imported
  again
- **THEN** the new rows are `ZONES-009…016`, never `-001` again.

### Requirement: bound_table_sheds_binding_only
Deleting a Table bound to an external Data Source SHALL remove the local binding —
definition, column definitions and sidecars — and SHALL issue **no DDL against the
source**. Because the operation is local-only, it SHALL succeed even when the source is
unreachable.

#### Scenario: source_file_untouched
- **WHEN** a Table bound to a csv-folder source is deleted
- **THEN** the binding is gone and the source file is byte-identical.

### Requirement: attachment_bytes_unreachable
File registry rows referencing the Table SHALL be swept by `live_pointer_sweep`, which
alone makes the bytes unreachable (files are served only through a registry lookup). The
stored bytes SHALL be removed after commit, **best-effort**: a byte surviving a failed
unlink is disk garbage, not a data leak. Child-row attachments SHALL be selected from
the child ids actually deleted in the same transaction, so shared child storage, other
parents and child-table-level attachments survive. URLs SHALL be de-duplicated after
commit and unlinked only when no surviving `file` row references them. A rolled-back
deletion SHALL unlink nothing.

#### Scenario: shared_storage_survives
- **WHEN** two File rows in different Tables name the same stored URL and one Table is
  deleted
- **THEN** the surviving row keeps its bytes.

#### Scenario: rollback_never_unlinks
- **WHEN** the deletion transaction rolls back
- **THEN** no byte is unlinked.

### Requirement: deletion_logged_in_plain_text
Every successful deletion SHALL write an Access Log entry — who, which Table, when —
using plain-text columns, so the record outlives its subject (`live_pointer_sweep`
deliberately cannot reach it). If audit storage fails after commit, the deletion SHALL
still succeed with an operator warning; an audit failure SHALL neither skip byte cleanup
nor report a completed deletion as refused.

#### Scenario: audit_outage_does_not_report_refusal
- **WHEN** audit storage fails after the deletion has committed
- **THEN** the deletion is reported as done, cleanup still runs, and the operator is
  warned.

### Requirement: stale_pointer_gets_tombstone
Asking for a Table that was deleted SHALL answer with the deletion itself: a not-found
carrying "*X was deleted by ⟨user⟩ on ⟨date⟩*", read back from `deletion_logged_in_plain_text`'s
testimony at the moment of the miss. A name that never existed SHALL stay a plain "not
found" — a tombstone is only ever minted from a real burial. Where one name has been
buried twice, the **latest** deletion SHALL speak. Every surface resolving a Table by
name (deep link, Recents entry, list URL) SHALL inherit the message through the same
boundary.

#### Scenario: deleted_table_names_who_and_when
- **WHEN** a Table deleted yesterday is requested
- **THEN** the not-found reads "X was deleted by Administrator on 2026-08-04".

#### Scenario: never_created_name_stays_plain
- **WHEN** a name that never existed is requested
- **THEN** the not-found is plain: no burial, no tombstone.

#### Scenario: latest_burial_speaks
- **WHEN** a name has been created and deleted twice
- **THEN** the latest deletion's line is returned.

### Requirement: nothing_dangles
After a successful deletion of X: zero `column_def` rows SHALL target X (own, reference
or row-storage), zero rows anywhere SHALL hold X in a `Reference → Table` column, and no
physical table for X SHALL exist. Every *other* physical table's row count SHALL change
only by its declared pointer rows (`live_pointer_sweep`) and child rows
(`deletion_reverses_creation`).

#### Scenario: no_dangling_rows_anywhere
- **WHEN** a Table with sidecars in several tables is deleted
- **THEN** a sweep across every declared `Reference → Table` column finds no row naming
  it, and no other table's count moved for any other reason.

### Requirement: refusal_changes_nothing
Any refused or failed deletion SHALL leave every table, row count and sidecar exactly as
before: the operation is one transaction with no partial outcome. A retry after a
refusal SHALL be a fresh evaluation, never a queued intent, and a concurrent second
delete of the same Table SHALL get not-found.

#### Scenario: blocked_delete_moves_no_count
- **WHEN** a deletion is refused because another Table references it
- **THEN** every row count in the database is identical to before the attempt.

### Requirement: irreversible_one_click
Deletion cannot be undone, the affordance appears on every Table's list view, and the
platform has no backup story — a compound no single rule owns. The confirmation SHALL
name the Table and its **live row count** and SHALL say the deletion cannot be undone
("Delete Journey Zones? 8 rows will be permanently deleted. This cannot be undone."),
never a bare "are you sure". Mitigations in force: `system_manager_only`, this counted
dialog, `deletion_logged_in_plain_text`, `stale_pointer_gets_tombstone`. Typed-name
confirmation was considered and declined (Q1, ruled 2026-08-05: the counted dialog **is**
the confirmation rule).

#### Scenario: confirmation_carries_the_live_row_count
- **WHEN** a manager clicks Delete Table on a Table with eight rows
- **THEN** the dialog names the Table, says eight rows will be permanently deleted, and
  says it cannot be undone.

#### Scenario: cancel_leaves_everything
- **WHEN** the confirmation is dismissed
- **THEN** the list view and the row count are untouched.

### Requirement: delete_an_unwanted_table
A System Manager SHALL be able to delete an unwanted Table from its list view and
observe, without leaving the Admin: the destructive affordance beside Naming and
Permissions; a counted confirmation; a landing on **All tables** with the Table absent
from every module group; a tombstone on the direct URL; and an Import Log with no entry
naming it.

#### Scenario: gone_from_every_module_group
- **WHEN** the deletion is confirmed
- **THEN** the browser lands on All tables and the Table is absent from every group.

#### Scenario: direct_url_answers_with_the_tombstone
- **WHEN** the deleted Table's list URL is opened directly
- **THEN** the page names the deletion — who and when — rather than a bare error or an
  empty list.

### Requirement: refused_then_unblocked
A manager whose deletion is refused SHALL be told exactly what stands in the way, be able
to remove it, and retry successfully. The refusal SHALL name the referencing Table and
column ("Cannot delete Journey Zones: Journey Bookings.zone references it"), and the
Table and all its rows SHALL remain intact.

#### Scenario: refusal_names_the_blocker
- **WHEN** deletion of a referenced Table is confirmed
- **THEN** the refusal names the referencing `Table.column` and nothing is deleted.

#### Scenario: retry_after_unblocking_succeeds
- **WHEN** the referencing column is removed and the deletion retried
- **THEN** it completes exactly as the unblocked journey does.

## Open questions

None open. Ruled by the arbiter (Siraj) and graduated into the requirements above:

| Q | Ruled | Outcome |
|---|---|---|
| Q1 — typed-name confirmation? | 2026-08-05 | Declined; the counted dialog **is** the confirmation rule (`irreversible_one_click`). |
| Q2 — what does a stale pointer see? | 2026-08-04 | `stale_pointer_gets_tombstone`. |
| Q3 — an archive/inactive tier? | 2026-08-05 | Not now. Hard delete + swept pointers + testimony stands; archive would be a separate capability with its own journeys, reconsidered at first deployment — the same trigger that reopens `irreversible_one_click`'s residual risk. |
