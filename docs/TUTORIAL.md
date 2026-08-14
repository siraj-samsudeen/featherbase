# Your first Table: build a todo list

> **Note:** every HTTP step below (Table creation, generated table, id
> pattern, optimistic-lock update, Server Script validation, and the stretch
> test) has been verified against a live instance. If a step doesn't match
> what you see, trust the running app and please file an issue.

In this exercise you build a small task tracker from scratch — model, API,
and UI — without writing a line of application code. That's the point of the
platform: define a Table, and storage, validation, API, and UI are all
generated from it.

A `ToDo` Table already ships with the platform (it backs assignments — see
`apps/server/migrations/0022_todo.ts`). We'll build our own called **Task**
so nothing collides, and use the built-in ToDo as the reference solution to
compare against at the end.

## 0. Prerequisites

A running stack: `./init.sh` from the repo root boots Postgres, migrations,
the API on :8000, and the web app on :5173 (see
[CONTRIBUTING.md](../CONTRIBUTING.md)). Log in at http://localhost:5173 as
`Administrator` / `admin` (the default from
`apps/server/migrations/0006_admin_password.ts`; override with
`ADMIN_PASSWORD`).

## 1. Meet the Table Builder

The Admin UI has a Table builder at **`/admin/new-table`** — reachable from
the **“+ New Table”** link in the sidebar
(`apps/web/src/pages/AdminLayout.tsx`) or via the command palette
(Ctrl/Cmd+K). The page (`apps/web/src/pages/TableBuilder.tsx`) is a name
input plus a column grid with **Column Name · Label · Column Type · Target ·
Reqd · List**, an **+ Add column** row, and a **Create Table** button.
Choices for a Choice column can be typed comma- or newline-separated; the
builder normalizes them to the newline-separated form the engine expects
before POSTing to `POST /api/table_def`.

Try it with a throwaway Table — name it `Note`, give it a `title` (Data,
Reqd, List) and a `content` (Text) column, and click **Create Table**. You
land on `/admin/Note`, a fully working list view. That's the whole loop.

One caveat before we build the real thing: the builder currently exposes
only a subset of the definition — notably not `id_pattern` (naming-series
rules) or `default_value` — and a Table cannot be deleted once created
(`deleteDoc` in `apps/server/src/document.ts` refuses engine-managed rows).
Since the rest of this tutorial leans on an id pattern and a status default,
we'll create `Task` over HTTP.

## 2. Define `Task` over HTTP

The builder is just a client of the public API. The raw calls (routes
registered in `apps/server/src/index.ts`):

```bash
# Log in; the response body carries { token, user }.
TOKEN=$(curl -s http://localhost:8000/api/login \
  -H 'content-type: application/json' \
  -d '{"usr":"Administrator","pwd":"admin"}' | jq -r .token)

# Create the Table (System Manager only). id_pattern gives us a naming
# series: TASK-0001, TASK-0002, ... (four # = four digits).
curl -s http://localhost:8000/api/table_def \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{
    "name": "Task",
    "id_pattern": "TASK-.####",
    "columns": [
      { "column_name": "title",    "column_type": "Data",   "reqd": true, "in_list_view": true },
      { "column_name": "stage",    "column_type": "Choice", "choices": "Open\nDone", "default_value": "Open", "in_list_view": true },
      { "column_name": "due_date", "column_type": "Date",   "in_list_view": true },
      { "column_name": "priority", "column_type": "Choice", "choices": "Low\nMedium\nHigh", "default_value": "Medium" }
    ]
  }'
```

(`stage`, not `status` — every generated Table already has a reserved
`status` column for its draft/submitted/cancelled lifecycle, so a column
can't reuse that name.)

The column shape (`column_name`, `column_type`, `choices`, `reference_table`,
`row_table`, `reqd`, `unique`, `default_value`, `in_list_view`, `tier`, ...)
is validated by `tableDefSchema` in `apps/server/src/doctype-engine.ts`.
Compare with the canonical definitions in the metadata migrations —
`apps/server/migrations/0022_todo.ts` (ToDo) and
`apps/server/migrations/0036_workspace.ts` (Workspace) use exactly this
shape via `createTable`.

## 3. Watch the table appear

`createTable` generated a real Postgres table. Look at it:

```bash
psql "postgres://postgres:postgres@127.0.0.1:5432/featherbase" -c '\d task'
```

You'll see your four columns plus the standard columns every generated table
gets — `name` (primary key), `created_by`, `created_at`, `updated_at`,
`updated_by`, `status`, `position` (`STANDARD_COLUMNS` and `createTableDDL`
in `apps/server/src/doctype-engine.ts`). The metadata itself landed as rows
in `table_def` and `column_def`. The table also has row-level security
enabled with a generated read policy for the `app_client` role.

## 4. Use the generated UI

Open **http://localhost:5173/admin/Task**. The generic `ListView`
(`apps/web/src/components/ListView.tsx`) renders your list-flagged columns —
no Task-specific frontend code exists anywhere.

Create a task: a new row lives at **`/admin/Task/new`** (the literal
name `new` renders an empty `FormView` —
`apps/web/src/components/FormView.tsx`). Fill in a title and save; the form
POSTs to `/api/save_row` and the id pattern assigns `TASK-0001`.

Create a few more. Then try the HTTP equivalent:

```bash
curl -s http://localhost:8000/api/save_row \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"doctype":"Task","doc":{"title":"Read ARCHITECTURE.md","due_date":"2026-08-01"}}'
```

The response is the saved row, with `name`, `stage: "Open"` (your
default), and audit columns filled in.

To **complete** a task over HTTP you must echo the `updated_at` timestamp you
loaded — updates are optimistically locked (`saveDoc` in
`apps/server/src/document.ts` rejects a stale `updated_at` with a 409). The
generated Table surface is `PATCH /api/table/:table/:name` — PATCH, not PUT,
because a Table can gain columns at runtime via Custom Field, and a PUT from
a client that read a row before a column existed would silently null it:

```bash
DOC=$(curl -s http://localhost:8000/api/table/Task/TASK-0001 \
  -H "Authorization: Bearer $TOKEN")
UPDATED_AT=$(echo "$DOC" | jq -r .updated_at)

curl -s -X PATCH http://localhost:8000/api/table/Task/TASK-0001 \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"updated_at\":\"$UPDATED_AT\",\"stage\":\"Done\"}"
```

In the Admin UI the form does this for you. Filter the list to open tasks: the
list's filters live in the URL (`/admin/Task?filters=...`), so a filtered
view is shareable.

## 5. Add a validation — without redeploying

Let's enforce a rule: a task's title must be at least five characters.
**Server Scripts** are rows too (defined in
`apps/server/migrations/0037_server_script.ts`, executed by
`apps/server/src/server-scripts.ts` in a hardened `node:vm` sandbox inside
the save transaction).

Create one at `/admin/Server Script/new` (or via `save_row`):

- **name**: `task-title-length` (Server Script uses prompt naming)
- **script_type**: `Document Event`
- **ref_table**: `Task`
- **event**: `validate`
- **script**:

  ```js
  if (!doc.title || doc.title.length < 5) {
    frappe.throw('Title must be at least 5 characters')
  }
  ```

- **enabled**: checked

The script sees the row as `doc` and can call `frappe.throw(message)`
to abort the save (the sandbox exposes nothing else — no `process`, no
`fetch`). Now try saving a task titled "x": the save fails with a 417
validation error, in the Admin UI and over HTTP alike, because the script runs
inside `saveDoc` itself.

If you'd rather gate status changes by role, look at **Workflow**
(`apps/server/migrations/0015_workflow.ts`,
`apps/server/src/workflow.ts`): a Workflow row ties states and
role-gated transitions to a Table, and the form grows action buttons via
`/api/workflow/:doctype/:name`. That's a good second exercise.

## 6. Compare with the reference solution

Open `/admin/ToDo` — the built-in equivalent. Its definition in
`apps/server/migrations/0022_todo.ts` is a superset of what you built:
`allocated_to` is a **Reference** column pointing at `User`, and
`ref_table`/`reference_name` let a ToDo point at any row (this
is what `/api/assign` creates). Reference columns get you referential
integrity for free — the save path verifies the target row exists
(`validateLinks` in `apps/server/src/document.ts`), and deletion of a
referenced row is blocked.

## 7. Stretch: write a sandboxed test

Server tests run against the real Postgres inside a rolled-back transaction
(see [TESTING.md](TESTING.md)). Model yours on
`apps/server/test/naming.test.ts`. Create
`apps/server/test/task-tutorial.test.ts`:

```ts
import { describe, expect } from 'vitest'
import { test } from './pg-test'

describe('Task tutorial', () => {
  test('creates tasks with series names and the stage default', async ({ admin }) => {
    await admin.post('/api/table_def', {
      name: 'Tutorial Task',
      id_pattern: 'TUT-.####',
      columns: [
        { column_name: 'title', column_type: 'Data', reqd: true },
        { column_name: 'stage', column_type: 'Choice', choices: 'Open\nDone', default_value: 'Open' },
      ],
    })
    const doc = await admin.post<{ name: string; stage: string }>('/api/save_row', {
      table: 'Tutorial Task',
      row: { title: 'Write the tutorial' },
    })
    expect(doc.name).toBe('TUT-0001')
    expect(doc.stage).toBe('Open')
  })
})
```

Run just this file:

```bash
pnpm --filter server test test/task-tutorial.test.ts
```

Two things worth noticing. The Table is named `Tutorial Task`, not `Task`:
the test's transaction rolls back, but it still *sees* committed state, so
reusing the `Task` you created earlier would make `/api/table_def` answer 409.
And asserting `TUT-0001` is safe precisely because the series counter row is
created inside the rolled-back transaction — every run starts the series
fresh.

## Where to go next

- [ARCHITECTURE.md](ARCHITECTURE.md) traces exactly what happened on each of
  your saves.
- [GLOSSARY.md](GLOSSARY.md) explains the vocabulary you just used (and its
  Frappe-era predecessor terms, if that's where you're coming from).
- Try `permissions/Task` in the Admin UI to grant a non-admin role access, then
  log in as a second user.
