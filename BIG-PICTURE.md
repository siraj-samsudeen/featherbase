# The big picture

What Featherbase is becoming, beyond the first build. Agreed between the owner and Claude in the design
discussion of 15 and 16 November 2026. Nothing here is built. Read it so that what you build now does not
close off what comes later.

Featherbase is an app builder on a database: a better Airtable and a better Frappe. Its core is bringing data
in, cleaning it, and managing it as master data. It replaces an earlier system, reviewed in
`background/old-system-review.md`.

**Where a Table lives.** The owner's real cases: own Postgres; a control-plane Postgres
that is only read, discussed and ticketed; MotherDuck warehouses that are only read; curation data (identifiers,
merges, own attributes) that today lives in the warehouse repo's seeds; later, a client's MySQL that must never be
touched.

1. **Featherbase never writes into a database it does not own as part of a save.** A save commits in
   Featherbase's Postgres only. Sending a change to a source system is a separate, detached step with its own
   retry: the save records "to be sent" in the same transaction, and a sender delivers it afterwards.
   The owner expects Featherbase to become the master data system: employees and items are created and corrected
   here and sent back to the source systems. This is already starting for employee master data.
   Featherbase's own changes reach the warehouse through the owner's change-data-capture package
   (Featherbase Postgres CDC, part of Featherflow), which loads them into `bronze_featherbase` in MotherDuck.
   That answers how the pipeline reads curation data.
2. **Every Table has a source part and a Featherbase part.** The source part is the raw rows, read-only. The
   Featherbase part is everything people add (own Columns, comments, links, identifiers, merges, issues,
   corrections, history, access rules), always in Featherbase's Postgres, attached by the row's key. A managed
   Table has no source part.
3. **Three ways to read a source part:** live, cached copy, or brought over (copied once, then owned).
4. **A declared key, possibly several Columns,** is required before anything can be attached to an outside row.
5. **A warehouse is browsed as a catalogue** (database, schema, table) with access granted on containers; a
   Table is made from a catalogue entry when one is needed.
6. **Dropped:** changing the shape of an outside database, and editing rows of a Table Featherbase does not
   own.
7. **"Seeds" means curation data,** not an app's starting rows: identifiers, merges and own attributes.

**Consequences to design for (raised 15-Nov, not yet discussed in full):**

- **The physical shape of Featherbase's tables is a contract.** The change-data-capture package reads them, so
  a renamed table or Column changes `bronze_featherbase`. The Featherbase part of a Table should be stored as
  plain Columns in one table per Table, not as key-value rows or JSON, and renames need a notice to the pipeline.
- **Deletes and merges must be visible downstream.** Retire a row and point a merged row at its survivor;
  do not hard-delete.
- **One owner per Column.** For each Column either the source system or Featherbase is the owner. Without that,
  a value pushed to the source and loaded back looks like a conflict, or the two overwrite each other in turn.
- **An explicit hand-over per entity.** Before it, the source owns the employee and Featherbase curates. After
  it, Featherbase owns the employee and the source receives. Identifiers are the map used to address the row in
  each system.
- **A row created in Featherbase has no id in the source yet.** The source assigns one later; it returns as an
  Identifier.
- **Delivery states are visible.** A row can be saved here and not yet accepted by the source, or refused by
  it. A refusal is an Issue someone works through.
- **Sending needs write credentials for source systems,** a larger security surface than read-only access.

Default working answers, to confirm: alerts on control-plane rows by polling about once a minute; corrections
to single transactions (the barcode case) held as an Issue plus an override.

**Keys.** Featherbase gives each source row it attaches anything to its own permanent
id (an anchor). The source's key is stored beside it as plain Columns, one per key Column, unique together.
An anchor is created when something is first attached, not for every source row. A source key is the same
concept as an Identifier: the values by which one system knows the row. Two source rows with one key share an
anchor and raise a duplicate-key Issue. Warehouse surrogate keys should be a hash of the natural key, not a
counter.

**From browsing to owning.** An entity moves through three stages: browse (the source owns everything;
Featherbase reads, discusses, raises tickets), curate (Featherbase adds decisions beside the raw values), own
(Featherbase is the master and sends changes to the source). The pieces: raw, anchor, Issue, decision
(identifier, merge, own attribute, override, exclude, and create at the third stage), out to the warehouse
through the owner's change-data-capture package, out to the source as a detached send, re-check.

**First build, chosen by the owner:** start from Excel.
1. Import a clean master from a spreadsheet: the file is kept, the rows become a Table, people browse it.
2. Import and clean up: Issues are recorded, people correct them, clean rows go in, a re-import keeps their
   decisions. The owner calls this "the very core of everything we do".

The warehouse catalogue, curation of warehouse entities and sending to source systems follow on the same
mechanism.

**Parked:** the Featherflow configuration that lives in a YAML file and should be editable in Featherbase
(one owner: either Featherbase owns it and writes the file out, or the file owns it). To be looked at when the
packages are added to the session.

## Agreed for later

- **Regrouping is free.** A module is a label on a Table for menus and lists; changing it touches nothing in
  Postgres.
- **Moving a Table between `main` and an app, or renaming a schema, is one deliberate step** in one
  transaction. Postgres moves a table to another schema without copying data.
- **A name history** records every move and rename (this Table was `main.employees` until this date, then
  `hr.employees`). It travels to MotherDuck through the change-data-capture package so the pipeline can follow
  a Table across a rename and rewrite itself. Old addresses are answered from it.
- **A preview before a move**, and a refusal when the new name is already taken.
- **Soft delete as a switch.** Later, a Table can be set so that delete marks the row and hides it, with the
  mark travelling to the warehouse. Before the first sync to MotherDuck, check that the change-data-capture
  package sees removed rows; if it finds changes by looking for updated rows, it will not.
- **Active and inactive** rows, built on top of that: a row that is no longer current, as opposed to one that
  should never have existed.
- **The uploaded file is a safety net for a while, not a permanent record.** Its purpose is protection during
  clean-up: people come back with an older version of a sheet and overwrite the right one (the owner has seen
  this with budgets). After some time the file is not worth carrying. So later: a keep-for period, after which
  the bytes and the raw rows are archived to object storage or removed, while the upload record (name,
  checksum, date) stays. What that safety net needs while the file is kept: undo of an import; recognising a
  file that was uploaded before, by its checksum; and a warning when a re-import would put values back to
  what an earlier upload held.

## How the work is split

- **Design, review and integration** happen in the owner's planning session with Claude. It holds the big
  picture: this spec, the mock-up, `TESTING.md`, and the review of each slice.
- **Building and verifying** happen in coding sessions on the owner's computer, one slice at a time, each as a
  pull request into `featherbase-redesign`.
- **Small design questions** that come up while building are settled there, between the owner and the
  building agent. Each one is added as a row to the decisions table above, in the same pull request, so the
  review is made against the design as it now stands.
- **Kept at the planning level:** anything that is a contract with the warehouse or touches every Table, such
  as Featherbase's own columns and what delete means.
- **A slice is reviewed for:** one test per sentence and none without; tests reaching the app only from
  outside; folder names matching the sentences; no expectation changed without its sentence changing; the
  recording matching the mock-up; decisions recorded.
