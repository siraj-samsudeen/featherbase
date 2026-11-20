# The big picture

What Featherbase is becoming, beyond the first build. Agreed between the owner and Claude in the design
discussion of 15 and 16 November 2026. Nothing here is built. Read it so that what you build now does not
close off what comes later.

A review on 19 and 20 November 2026 rethought this document from first principles. Where an answer
changed something here, the text below is already changed and names the decision. The decisions
themselves, with the options weighed, are in section 11 of `APPS-AND-SHARING.md`.

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
3. **An outside Table is always read as a copy in Featherbase's Postgres** (decision 41). The copy
   shows its "as of" time and can be refreshed, on demand or on a schedule. A refresh works like a
   re-import: the source's Columns are updated and what people added is kept. This replaces "three ways
   to read a source part" (live, cached copy, brought over). Live reading is added later only if a real
   case cannot be served by a copy.
4. **What makes a record unique, possibly several Columns,** is needed wherever rows have to be matched:
   a re-import, a refresh, or another Table pointing at this one. It is never needed just to import
   (decision 38).
5. **A warehouse is browsed as a catalogue** (database, schema, table) in a read-only viewer, with access
   granted on containers. Rows can be paged, sorted and filtered simply, and nothing can be added to them
   there. A Table is made from a catalogue entry, by copying it in, when someone needs to add anything
   (decision 41).
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

**Keys.** Every row of every Table has an id made by Featherbase (`_id`), and that is what tells rows
apart. No key has to be picked to import a file. What makes a record unique is a separate rule, one
Column or several, set at import, later, or when a re-import asks how to match (decision 38). The rest
of this paragraph is as first written, for outside rows; how the anchor looks now that an outside Table
is always a copy has not been re-discussed (`APPS-AND-SHARING.md`, section 9, item 23). Featherbase gives each source row it attaches anything to its own permanent
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

**Links between Tables.** A link is two columns: the id of the row it points at, which decides, and a
readable copy of that row's name, which Featherbase refreshes in the same save whenever the row is
renamed (decision 39). Deleting a row that others point at is refused, with the list of who points at
it; retiring a row arrives with soft delete (decision 40).

**Where a Table is kept.** One real Postgres table per Table, one real column per Column (decision 35,
confirming what was written). Shared, designed Tables are in schema `masters`; each app has its own
schema; each person gets a work area once people sign in; Featherbase's own upkeep tables are in schema
`featherbase` and never show when browsing (decisions 36 and 37). Until sign-in exists an import lands
in `masters`.

**Who is acting.** Every read and write passes one gate from the first build. Until sign-in exists its
answer is always "the owner, yes" (decision 42).

**First real use, chosen by the owner:** his own warehouse clean-up, before replacing a client's app and
before the app platform (decision 30). Start from Excel, with made-up data first (decision 31).
1. Import a clean master from a spreadsheet: the file is kept, the rows become a Table, people browse it.
2. Links between Tables, from a clean workbook with several sheets. A link that finds no match refuses
   the import (decision 32).
3. Import and clean up: Issues are recorded, people correct them, clean rows go in, a re-import keeps their
   decisions. The owner calls this "the very core of everything we do". The refused link of step 2
   becomes an Issue here.

The warehouse catalogue, curation of warehouse entities and sending to source systems follow on the same
mechanism.

**Parked:** the Featherflow configuration that lives in a YAML file and should be editable in Featherbase
(one owner: either Featherbase owns it and writes the file out, or the file owns it). To be looked at when the
packages are added to the session.

## Agreed for later

- **Regrouping is free.** A module is a label on a Table for menus and lists; changing it touches nothing in
  Postgres.
- **Moving a Table between `masters` and an app, or renaming a schema, is one deliberate step** in one
  transaction. Postgres moves a table to another schema without copying data.
- **A name history** records every move and rename (this Table was `masters.employees` until this date, then
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
