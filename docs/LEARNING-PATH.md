# Learning Path — own the engine by building a todo app

> Written 2026-07-26 for the owner's stated goal: *understand and own
> every layer completely* by building something small end-to-end, then
> complicating it one concept at a time. Each stage names the harness
> features it exercises (their IDs link to tests and code in the
> Explorer site), gives a verify checklist, and ends with questions
> worth answering before moving on. Do the stages in order; each one
> introduces exactly one new engine concept.

**Ground rule:** build everything twice — once through the Desk UI, once
through raw HTTP (`curl` or the browser console) — because the UI is
generated from the same metadata the API serves, and seeing both is how
the "everything derives from DocType metadata" invariant becomes real.

## Stage 0 — Boot and orient (30 min)

Run `./init.sh`, log in as Administrator, open an existing DocType (ToDo
ships with core) in list and form view. Skim `docs/ARCHITECTURE.md`'s
save_doc walkthrough once — you'll re-read pieces of it at every stage.

*Exercises:* the boot protocol; the generic Desk (UI-001…). No new
concepts — this stage is calibration.

## Stage 1 — Plain CRUD: the `Todo Item` DocType (half a day)

The MVC-tutorial equivalent, done the metadata way. Create a DocType
`Todo Item` with fields: `title` (Data, required), `done` (Check,
default off), `notes` (Text). No controller, no code.

Through the Desk: create, edit, complete, delete items. Through HTTP:
`POST /api/resource/Todo Item`, list with filters
(`[["done","=",0]]`), update, delete.

*Exercises:* META-001/002/003 (a real `tab_todo_item` table appears —
inspect it with psql), META-005 (standard columns filled in), META-010
(reqd/default enforced), DOC-001/010 (save + list), DOC-011 (send an
invalid payload, read the field-wise error), API-001…
*Verify:* the table exists with your columns; a missing `title` errors
field-wise over both surfaces; the list filter works over HTTP.
*Questions to answer before Stage 2:* where did the column types come
from? What wrote `creation`/`modified`? What happens in one transaction
when you save?

## Stage 2 — Projects: a second DocType and a Link (half a day)

Create `Todo Project` (fields: `title`, `description`), then add a
`project` **Link field** on `Todo Item` pointing to it. Try to delete a
project that still has items.

*Exercises:* META-008 (link integrity on save — bogus project name
rejected), DOC-006 (delete blocked while referenced), DOC-012 (rename a
project; watch items follow), UI-002/UI-003 (filter items by project in the generated list view) and UI-006 (the link field renders as a debounced typeahead).
*Verify:* saving an item with a nonexistent project fails field-wise;
deleting a referenced project fails naming the blocker; renaming the
project updates every item's `project` value.
*Questions:* how does the engine know what links to what? (Read the
delete-integrity code the Explorer links from DOC-006.) What would a
dangling reference cost you in a system without this?

## Stage 3 — Subtasks: the child table (half a day)

Create `Todo Subtask` with `istable` on (fields: `description`, `done`),
and add a Table field `subtasks` on `Todo Item`. Add/edit/remove/reorder
subtask rows in the form; save the parent with an invalid subtask row
and watch the whole save roll back.

*Exercises:* META-007 (parent/parenttype/parentfield/idx columns),
DOC-005 (child rows atomic with parent — the reconciliation on resave),
UI-007 (the child grid editor is generated, zero frontend code).
*Verify:* child rows live in `tab_todo_subtask` carrying parent linkage
and `idx` order; a child validation error aborts the parent save
entirely; reordering persists.
*Questions:* why are child rows modeled as their own DocType instead of
JSON on the parent? What does that buy for queries and permissions?

## Stage 4 — Checklists: field flags, Select, and a controller (1 day)

Add to `Todo Item`: `priority` (Select: Low/Medium/High, default
Medium), `due_date` (Date), and make `notes` visible only when a Check
`has_notes` is on (depends_on). Then write your **first controller**: a
`validate` hook rejecting a `due_date` in the past, and a `before_save`
that auto-sets `priority` High when due within 48h.

*Exercises:* META-009 (Select validated against options), META-010,
DOC-003/DOC-004 (lifecycle hooks; a thrown error aborts the
transaction), UI conditional display.
*Verify:* an out-of-options priority is rejected over raw HTTP (not
just hidden by the UI); the past-due save fails from the *hook*, and the
row is untouched; the auto-priority shows in the response.
*Questions:* trace the order validate → before_save → write →
after_save in `document.ts`. What runs inside the transaction? What
would you now do in a hook vs. in the client?

## Stage 5 — A second user: permissions (1 day)

Create a `Todo User` role; give it read/write/create on `Todo Item` but
read-only on `Todo Project`; make a non-admin user; add an `if_owner`
DocPerm so users only see their own items. Log in as them (or use their
API token) and retry everything from Stages 1–4.

*Exercises:* PERM-001… (role permissions, if_owner row-scoping), the
RLS layer underneath, API auth (tokens/sessions).
*Verify:* the second user cannot create a project, cannot see your
items, and every restriction holds over raw HTTP — the UI hiding a
button is not the test.
*Questions:* where is each check enforced — server, RLS, or both? Why
does the UI-only check never count?

## Stage 6 — Make it live and useful (optional, 1 day)

Pick any two: a naming series (`TODO-.####`, META-006 — watch the atomic
counter under parallel inserts), an assignment rule that round-robins
new items (background jobs, JOB-*), an email notification on completion
(EML-*), a Kanban-ish saved filter set, or a public web form (WEB-*)
for submitting todos without login.

*Verify:* each through its own feature's `verify` line in the harness.

## After the path

You will have touched, deliberately: the metadata engine, DDL
generation, the document lifecycle, links, child tables, hooks, the
permission stack, and one integration surface — which is the entire
core of the framework. At that point read
`docs/design/data-and-admin-topology.md` end to end; every axis will
now map to something you've held. Then the M1 milestone (dbt seeds →
DocTypes) is exactly Stage 1–2 skills applied to real client data.
