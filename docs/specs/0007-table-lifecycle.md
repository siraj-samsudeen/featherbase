# Feature: Table Lifecycle

**IDs:** `TLC-J*` journeys · `TLC-R*` rules · `TLC-I*` invariants ·
`TLC-H*` hazards · `Q*` questions
**Evidence:** a `> evidence:` verdict under each obligation below;
linkage checked by `tools/check-evidence.mjs`
**Provenance:** owner direction 2026-08-30 — "this should be the role model
feature". Recovered from shipped behaviour: GitHub issue #249 mapped what a
table owner can and cannot do today, from a live stack. The **row** half is
built here; the **schema** half is specified with `gap` verdicts against its
own issues, so the debt is visible to CI rather than to memory.

## The job

TLC-J1 — "I declared a table. Now let me put something in it — without
being told a URL."

TLC-J2 — "This row was a mistake. Take it out, from the row I am looking
at, and tell me first if something depends on it."

TLC-J3 — "The shape is wrong. Add a column, fix the valid values, rename
the one I misspelled." *(specified, not yet built — see the rules)*

## Prior state *(residue-shaped)*

What table creation leaves behind: a `table_def` row, its `column_def`
rows, a physical table with the standard columns, an RLS policy, a
permission row, and a home-page link for its module. That is the state
every journey below starts from, and the state the Admin currently
strands — the table exists and nothing in the UI will put a row in it.

**Limits, stated on purpose:** these journeys use a plain local table with
scalar columns. Bound tables (spec 0001) and sub-tables have their own
write rules and are named in TLC-R1/TLC-R3 rather than walked here.

## TLC-J1 — Declare a table, enter its first row *(shape: sequence)*

> evidence: proven — the whole walk is driven by clicking; the journey
> never navigates by URL after the first visit, which is the point of it.

Every step is reached from the previous one **by clicking**. A journey
that types a URL cannot witness whether a user could have got there
(TLC-H2), and that is precisely how this gap survived 60 spec files.

| # | Where / do | Must observably see | Rules |
|---|---|---|---|
| J1.1 | The table builder, having just created a table | Landed on the new table's list view — the round trip closes on the table, not on a form the builder happens to leave open | R1 |
| J1.2 | The list view of a table with no rows | An empty state that offers the way forward, and a **New** action in the toolbar beside Report and Import — never only in search | R1, I1 |
| J1.3 | Click **New** | The generic form for this table, addressed as a new row, every declared column rendered as its control | R2 |
| J1.4 | Fill the columns and **Save** | The saved row, addressed by its own id — not still "New document" | R2 |
| J1.5 | Click the table in the breadcrumb | The list, now carrying the row, with the total incremented | R2 |

**Branch at J1.2 — a Settings table.** A settings-kind table has one row
and no list, so it has no create affordance; opening it lands directly on
that row's form. *(→ R1.settings)*

**Branch at J1.2 — a read-only bound table.** No New action; the rows
belong to the source. *(→ R1.bound)*

**Isolation strategy:** self-cleaning through table deletion (spec 0003).
The journey pre-cleans its journey-owned table name through the very
capability under test, creates the table, and deletes it at the end — a
re-run meets a clean database and no skip path exists.

## TLC-J2 — Remove a row from the row itself *(deltas from J1 only)*

> evidence: proven — the counted confirmation, the cancel branch, the
> refusal naming its holder, and the list arriving one row lighter.

| # | Where / do | Must observably see | Rules |
|---|---|---|---|
| J2.1 | An existing row's form | A **Delete** action alongside Rename — the row I am looking at is the row I can remove | R3 |
| J2.2 | Click **Delete** | A confirmation **naming the row** ("Delete Journey Lifecycle Note note-1? This cannot be undone.") — never a bare "are you sure" | R4, H1 |
| J2.3 | Confirm | Landed on the table's list; the row absent; the total decremented | R3 |

**Branch at J2.2 — cancel.** Dismiss the confirmation: the form is still
there, the row untouched. *(→ R4)*

**Branch at J2.3 — something references it.** The confirmation reports the
server's refusal **naming the holder** ("Journey Lifecycle Ref ref-1
references it") and the row survives. *(→ R3.referenced)*

**Isolation strategy:** as J1 — journey-owned names, pre-cleaned through
table deletion, referrer deleted before referent so the refusal branch
cannot strand its own fixture.

## Closure sweep

- **actors & permissions:** TLC-R1 — the create affordance follows the
  server's authority, never a second client-side rule; the server refuses
  an unpermitted write whatever the UI rendered. *(The Desk does not yet
  read a per-table create permission — TLC-R1.permission.)*
- **prior state & lifecycle (incl. reversal):** TLC-H1 — row deletion is
  irreversible and row-level; the table-level equivalent is spec 0003.
  A submitted row is refused until cancelled (TLC-R3).
- **concurrency & retries:** TLC-R3 — deletion is one transaction taking
  `for update` on the row; a second delete of the same row gets not-found,
  and a retry after refusal is a fresh evaluation, not a queued intent.
- **external-dependency failure:** TLC-R1.bound / TLC-R3.bound — a bound
  table's rows live on the source; the affordance is absent when the
  source is not writable, and delete is delegated with an optimistic echo.
- **durability & recovery:** deletion writes through the same transaction
  as any row write; no partial state survives a failure. Covered by R3.
- **security & privacy:** *(none — creating and deleting rows adds no new
  surface; RLS and column tiers already govern both paths.)*
- **accessibility:** the confirmation is a real dialog — labelled,
  `aria-modal`, Escape-dismissable, confirm and cancel reachable by tab.
  Asserted in J2's walk, no separate ID.
- **performance & scale:** *(none — both operations are single-row and
  indexed; the reference scan is one indexed probe per declaring column.)*
- **observability:** both paths publish a realtime row event and record a
  version row. Covered by R2/R3 — no separate ID.
- **compound hazards:** TLC-H1, TLC-H2.

## The rules

### TLC-R1 — Where the create affordance appears · `shape: rule`

> evidence: proven — the affordance renders on a writable table and is
> absent on a settings table, both witnessed in the browser.

The affordance is derived from metadata, never written per table. It is
**absent, not disabled**, wherever a row cannot be created.

**Property:** for every table a signed-in user can navigate to, the list
view offers exactly one create affordance if and only if that table
accepts new rows from this Desk.

| Table | New action | Why? |
|---|---|---|
| A plain local table | present | rows are created here |
| A read-only bound table | absent | the rows belong to the source (EDS-13) |
| A writable bound table | present | the source accepts writes |
| A settings table | *rejected* | one row, no list — the route opens that row |
| A sub-table | *rejected* | rows exist only inside a parent |

> evidence TLC-R1.settings: proven — a settings table opens its single
> row's form and offers no create affordance.

> evidence TLC-R1.sub_table: proven — a child table reached directly renders
> its list with neither create affordance. The gate initially checked only
> `settings`, so the shipped code contradicted this rule's own example table
> until the #258 review caught it.

> evidence TLC-R1.bound: proven — a csv-folder source reflected at
> `read_only` renders its list with neither create affordance. Added in the
> #258 review response, where a writable binding was needed anyway; the
> shared helper `isSourceReadOnly` is the single point both specs gate on.

> evidence TLC-R1.permission: gap #249 — the Desk renders the affordance for any signed-in
> user and lets the server refuse the write. Honest but late: a user
> without create permission sees a button that will fail. Needs a
> per-table create flag on the meta payload.

### TLC-R2 — Creating a row · `shape: contract`

> evidence: proven — the create round trip through the documented
> address, with the id assigned by the table's own pattern.

`POST /api/save_row` with `{ table, row }` — the address is the
contract's identity. The same operation the form issues:

- A row with no `row_id` is an insert; the id comes from the table's id
  pattern, never from the client.
- The response carries the assigned `row_id` and the standard columns, so
  the caller can address the row it just made without a second read.
- Validation failures return the column-keyed error map (`417`), which is
  what the form renders inline under each control.
- The whole automation chain runs in one transaction — sub-tables and id
  patterns included.

### TLC-R3 — Deleting a row · `shape: contract`

> evidence: proven — the not-found, submitted and engine-managed
> refusals, and the successful delete, each at the documented address.

`DELETE /api/table/:table/:name` — the address is the contract's identity.

- A row that exists and is unreferenced is removed; the response is
  `{ ok: true }`.
- A row that does not exist is `404`, not a silent success.
- A **submitted** row is refused until it is cancelled — deletion never
  bypasses the submit lifecycle.
- Settings, sub-table and engine-managed tables refuse direct row
  deletion, naming the table.
- A bound table delegates to its source, with an optional `updated_at`
  echo so a positional source (csv-folder) cannot delete the wrong row.

> evidence TLC-R3.referenced: proven — the refusal names the referencing
> row, and the row survives it.

> evidence TLC-R3.bound: proven — a writable csv-folder binding refuses a
> delete that omits the loaded revision, so the form echoes it: the test
> asserts both the wire (the stamp is on the DELETE) and the outcome (the
> row leaves the source). Red before the #258 review fix, which is where
> this clause was found unimplemented on the form path.

A row referenced by any Reference column in any table is refused, and the
message **names the holder** — the referencing table and row — so the
user knows what to undo. This is the row-level twin of DEL-R3.

### TLC-R4 — Irreversible actions name what they destroy · `shape: rule`

> evidence: proven — the dialog names the row and says it cannot be
> undone; the cancel branch leaves the row untouched.

**Property:** no irreversible act commits without a confirmation that
names its specific target; a confirmation that could be shown for any
target is not one.

| Confirmation says | Verdict | Why? |
|---|---|---|
| "Delete Journey Lifecycle Note note-1? This cannot be undone." | accepted | names the row |
| "8 rows will be permanently deleted." (table delete, DEL-R1) | accepted | names the cost |
| "Are you sure?" | *rejected* | true of every target; carries no information |

The row dialog and the table dialog (spec 0003) are deliberately the same
shape — labelled, `aria-modal`, Escape-dismissable, destructive action on
the right — so the confirmation reads the same wherever it appears.

### TLC-R5 — Editing a table's columns after creation · `shape: contract`

> evidence: gap #209 — the server accepts all of it today; nothing in the
> Admin calls it. `TableBuilder` is mounted only at `/admin/new-table`
> and reads no table parameter, so its grid can only describe a table
> that does not exist yet.

`PUT /api/table_def/:name` — the address is the contract's identity. It
already accepts, and the Admin must reach: adding a column · changing a
Choice column's valid values · reordering columns · changing `label`,
`reqd`, `unique`, `default_value`, `read_only`, `hidden`, `in_list_view`
and `tier` · removing a column, whose data is retained unless
`drop_columns` says otherwise.

### TLC-R6 — A column's identity survives an edit · `shape: rule`

> evidence: pinned #250 — `updateTable` diffs by `column_name`, so a
> rename is a delete plus an insert and the column's data becomes
> unreachable through every read path, with a 200.

**Property:** for every metadata edit, a value readable before the edit is
readable after it — under some name the metadata still declares.

| Edit | Data afterwards | Why? |
|---|---|---|
| Add a column | untouched | additive |
| Change a label | untouched | the machine name is the identity |
| Remove a column without `drop_columns` | retained, and reachable again if re-declared | the flag is the only licence to destroy |
| Rename `title` → `headline` | *rejected* — today the values vanish from every read | a rename must move data or refuse, never silently strand it |

### TLC-R7 — A definition write reports what it did · `shape: contract`

> evidence: pinned #251 — a `PUT` whose body carries a different `name`
> returns 200 with the old name, and a partial payload deletes every
> column it omitted.

`PUT /api/table_def/:name` must refuse what it will not do. Ignoring a
field the caller sent and answering 200 makes the response a false record
of the request.

### TLC-R8 — Changing a column's type · `shape: contract`

> evidence: gap #253 — refused with a bare 417 and no path forward; the
> semantics are Q1, unanswered.

### TLC-R9 — A table's grouping · `shape: contract`

> evidence: gap #255 — `updateTable` writes `module`; no UI sends it, so
> a table is stuck in the module it was born in.

### TLC-R10 — Renaming a table · `shape: contract`

> evidence: gap #254 — no operation exists; the nearest thing reports
> false success (TLC-R7). Whether the machine identity is mutable at all
> is Q3.

### Invariants

- **TLC-I1 — Every navigable table is one click from its first row.**
  For every table a signed-in user can reach, a create affordance is
  present on its list view or a rule above says why it is absent. The
  affordance is never *only* in the search bar: a discoverability that
  requires knowing the table's name is not one.

  > evidence: proven — witnessed on a freshly created table, which is the
  > case that was broken.

- **TLC-I2 — No metadata edit makes existing data unreachable.**
  Across any sequence of definition writes, every value ever written is
  either readable through the current metadata or was destroyed by an
  explicit, acknowledged instruction.

  > evidence: pinned #250 — a column rename violates this today.

- **TLC-I3 — A 2xx describes the operation that happened.**
  No successful response may report a name, or a shape, that the request
  did not achieve.

  > evidence: pinned #251 — `PUT /api/table_def/:name` violates this for
  > a changed `name`.

### Hazards

- **TLC-H1 — Row deletion is irreversible.** There is no recycle bin at
  row level; the version trail records what a row *was*, but nothing
  restores it. Mitigated by TLC-R4's naming confirmation and by TLC-R3's
  refusals, which make the common accidents impossible rather than
  merely regrettable.

  > evidence: proven via TLC-J2 — the naming confirmation, the cancel
  > branch and the referenced-row refusal are all witnessed; the
  > irreversibility itself is accepted, not mitigated further.

- **TLC-H2 — A test that navigates by URL cannot witness an affordance.**
  A suite can cover every form and still miss that no user can reach it.
  This is how #247 survived 60 e2e files and 117 `page.goto` calls, and
  how `UI-011` stood as "passing" against half its own title. Mitigated
  by TLC-J1's rule: at least one journey per surface arrives by clicking,
  end to end, with no URL navigation after the entry point.

  > evidence: proven via TLC-J1 — that journey clicks its way from the
  > builder to a saved row and back, so the mitigation IS the journey.
  > Broader adoption across the existing suite is #257.

## Open questions *(arbiter: repo owner)*

| # | Question | Blocked on |
|---|---|---|
| Q1 | Column type change: migrate in place with a cast rehearsal, refuse with a stated reason, or offer a guided copy-into-new-column? | #253 |
| Q2 | Column rename: physical `ALTER … RENAME COLUMN`, or refuse and offer copy-then-drop? Either way the instruction must be explicit — a drop-one/add-one diff is genuinely ambiguous. | #250 |
| Q3 | Is a table's machine identity mutable at all, or does a table gain a mutable *label* distinct from its `name`? | #254 |
| Q4 | Should the Desk read a per-table create permission so TLC-R1.permission can render the affordance only where the write will succeed? | #249 |
