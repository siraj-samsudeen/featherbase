# Learning Path — own the engine by building a todo app

> Written 2026-07-26 (updated same day for the Table/Row/Column rename and
> the `/api/table` surface, PR #63) for the owner's stated goal:
> *understand and own every layer completely* by building something small
> end-to-end, then complicating it one concept at a time. Each stage names
> the harness features it exercises, gives a verify checklist, and ends
> with questions worth answering before moving on. Do the stages in order;
> each one introduces exactly one new engine concept.
>
> **Vocabulary note:** the harness feature IDs (META-*, DOC-*, …) were
> written in the original Frappe-era vocabulary — DocType/Doc/Field — and
> `harness/features.json` is frozen by rule. The codebase now says
> **Table / Row / Column** (see `docs/GLOSSARY.md`). Read feature titles
> with that mapping in mind; this path uses the new words.

**Ground rule:** build everything twice — once through the Admin UI, once
through raw HTTP (`curl` or the browser console) — because the UI is
generated from the same metadata the API serves, and seeing both is how
the "everything derives from Table metadata" invariant becomes real.

## Stage 0 — Boot and orient (30 min)

Run `./init.sh`, log in as Administrator, open an existing Table (ToDo
ships with core) in list and form view. Skim `docs/ARCHITECTURE.md`'s
save walkthrough once — you'll re-read pieces of it at every stage.

*Exercises:* the boot protocol; the generic Admin UI (UI-001…). No new
concepts — this stage is calibration.

## Stage 1 — Plain CRUD: the `Todo Item` Table (half a day)

The MVC-tutorial equivalent, done the metadata way. Create a Table
`Todo Item` with columns: `title` (Data, required), `done` (Check,
default off), `notes` (Text). No controller, no code. Over HTTP the
definition looks like (see `docs/TUTORIAL.md` for the full walkthrough):

```bash
curl -s http://localhost:8000/api/table_def \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Todo Item","columns":[
    {"column_name":"title","column_type":"Data","reqd":true,"in_list_view":true},
    {"column_name":"done","column_type":"Check","default_value":"0","in_list_view":true},
    {"column_name":"notes","column_type":"Text"}]}'
```

Then create, edit, complete, delete items — in the Admin, and over HTTP:
`POST /api/save_doc`, `GET /api/table/Todo Item` (with a filter for
`done = 0`), `PATCH /api/table/Todo Item/:name` (echoing `updated_at` —
optimistic locking), `DELETE`.

*Exercises:* META-001/002/003 (a real `todo_item` table appears — bare
name, no prefix; inspect with `psql \d todo_item`), META-005 (standard
columns `created_by`/`created_at`/`updated_at`/`status`/`position` filled
in), META-010 (reqd/default enforced), DOC-001/010 (save + list), DOC-002
(PATCH with a stale `updated_at` → 409), DOC-011 (send an invalid
payload, read the column-wise error), API-*.
*Verify:* the table exists with your columns; a missing `title` errors
column-wise over both surfaces; the filtered list works over HTTP.
*Gotcha to hit on purpose:* try to add a column named `status` — it's
rejected, because every Table reserves `status` for its
draft/submitted/cancelled lifecycle (use `stage` for your own states).
*Questions to answer before Stage 2:* where did the column types come
from? What wrote `created_at`/`updated_at`? What happens in one
transaction when you save?

## Stage 2 — Projects: a second Table and a Reference (half a day)

Create `Todo Project` (columns: `title`, `description`), then add a
`project` **Reference column** (formerly "Link") on `Todo Item` pointing
at it (`column_type: "Reference"`, `reference_table: "Todo Project"`).
Try to delete a project that still has items.

*Exercises:* META-008 (reference integrity on save — a bogus project name
is rejected), DOC-006 (delete blocked while referenced), DOC-012 (rename
a project; watch items follow), UI-002/UI-003 (filter items by project in
the generated list view) and UI-006 (the Reference column renders as a
debounced typeahead).
*Verify:* saving an item with a nonexistent project fails column-wise;
deleting a referenced project fails naming the blocker; renaming the
project updates every item's `project` value.
*Questions:* how does the engine know what references what? (Read
`validateLinks` in `document.ts` — the Explorer links it from DOC-006.)
What would a dangling reference cost you in a system without this?

## Stage 3 — Subtasks: the Sub-table (half a day)

Create `Todo Subtask` as a **Sub-table** (`kind: sub_table`; columns
`description`, `done`), and add a Sub-table column `subtasks` on
`Todo Item` (`column_type: "Sub-table"`, `row_table: "Todo Subtask"`).
Add/edit/remove/reorder subtask rows in the form; save the parent with an
invalid subtask row and watch the whole save roll back.

*Exercises:* META-007 (`parent`/`parenttype`/`parentfield` columns +
ordering), DOC-005 (sub-rows atomic with parent — the reconciliation on
resave), UI-007 (the sub-table grid editor is generated, zero frontend
code).
*Verify:* sub-rows live in `todo_subtask` carrying parent linkage and
order; a sub-row validation error aborts the parent save entirely;
reordering persists.
*Questions:* why are sub-rows modeled as their own Table instead of JSON
on the parent? What does that buy for queries and permissions?

## Stage 4 — Checklists: flags, Choice, and a controller (1 day)

Add to `Todo Item`: `priority` (Choice: Low/Medium/High, default Medium),
`due_date` (Date), and make `notes` visible only when a Check `has_notes`
is on (depends_on). Then write your **first controller**: a `validate`
hook rejecting a `due_date` in the past, and a `before_save` that
auto-sets `priority` High when due within 48h.

*Exercises:* META-009 (Choice validated against its `choices` list),
META-010, DOC-003/DOC-004 (lifecycle hooks; a thrown error aborts the
transaction), conditional display in the form.
*Verify:* an out-of-list priority is rejected over raw HTTP (not just
hidden by the UI); the past-due save fails from the *hook*, and the row
is untouched; the auto-priority shows in the response.
*Questions:* trace validate → before_save → write → after_save in
`document.ts`. What runs inside the transaction? What would you now do in
a hook vs. in the client?

## Stage 5 — A second user: permissions (1 day)

Create a `Todo User` role; give it read/write/create **Permission** rows
on `Todo Item` but read-only on `Todo Project`; make a non-admin user;
set **"own rows only"** (formerly `if_owner`) so users see only rows they
created. Log in as them (or use their API token) and retry everything
from Stages 1–4. Bonus: put one column on the `restricted` **tier** and
watch it stripped from their reads and writes.

*Exercises:* PERM-* (role Permissions, own-rows-only scoping, tiers), the
Postgres RLS layer underneath, API auth (tokens/sessions).
*Verify:* the second user cannot create a project, cannot see your items,
and every restriction holds over raw HTTP — the UI hiding a button is not
the test.
*Questions:* where is each check enforced — server, RLS, or both? Why
does a UI-only check never count?

## Stage 6 — Make it live and useful (optional, 1 day)

Pick any two: an **id pattern** (`TODO-.####`, META-006 — watch the
atomic, gapless counter under parallel inserts), an assignment rule that
round-robins new items (background jobs, JOB-*), an email notification on
completion (EML-*), a saved filtered view shared by URL, or a public web
form (WEB-*) for submitting todos without login.

*Verify:* each through its own feature's `verify` line in the harness.

## After the path

You will have touched, deliberately: the metadata engine, DDL generation,
the row lifecycle, references, sub-tables, hooks, the permission stack,
and one integration surface — which is the entire core of the framework.
At that point read `docs/design/data-and-admin-topology.md` end to end;
every axis will now map to something you've held. Then the M1 milestone
(dbt seeds → Tables) is exactly Stage 1–2 skills applied to real client
data.
