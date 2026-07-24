# Your first DocType: build a todo list

> **Note:** every HTTP step below (DocType creation, generated table, naming
> series, optimistic-lock update, Server Script validation, and the stretch
> test) has been verified against a live instance. If a step doesn't match
> what you see, trust the running app and please file an issue.

In this exercise you build a small task tracker from scratch — model, API,
and UI — without writing a line of application code. That's the point of the
platform: define a DocType, and storage, validation, API, and UI are all
generated from it.

A `ToDo` DocType already ships with the platform (it backs assignments — see
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

## 1. Meet the DocType Builder

The Desk has a DocType builder at **`/desk/new-doctype`** — reachable from
the **“+ New DocType”** link in the sidebar
(`apps/web/src/pages/DeskLayout.tsx`) or via the command palette
(Ctrl/Cmd+K). The page (`apps/web/src/pages/DocTypeBuilder.tsx`) is a name
input plus a field grid with columns **Fieldname · Label · Type · Options ·
Reqd · List**, an **+ Add field** row, and a **Create DocType** button.
Options for a Select can be typed comma- or newline-separated; the builder
normalizes them to the newline-separated form the engine expects before
POSTing to `POST /api/doctype`.

Try it with a throwaway DocType — name it `Note`, give it a `title` (Data,
Reqd, List) and a `content` (Text) field, and click **Create DocType**. You
land on `/desk/Note`, a fully working list view. That's the whole loop.

One caveat before we build the real thing: the builder currently exposes
only a subset of the definition — notably not `autoname` (naming rules) or
`default_value` — and a DocType cannot be deleted once created (`deleteDoc`
in `apps/server/src/document.ts` refuses engine-managed documents). Since
the rest of this tutorial leans on a naming series and a status default,
we'll create `Task` over HTTP.

## 2. Define `Task` over HTTP

The builder is just a client of the public API. The raw calls (routes
registered in `apps/server/src/index.ts`):

```bash
# Log in; the response body carries { token, user }.
TOKEN=$(curl -s http://localhost:8000/api/login \
  -H 'content-type: application/json' \
  -d '{"usr":"Administrator","pwd":"admin"}' | jq -r .token)

# Create the DocType (System Manager only). autoname gives us a naming
# series: TASK-0001, TASK-0002, ... (four # = four digits).
curl -s http://localhost:8000/api/doctype \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{
    "name": "Task",
    "autoname": "TASK-.####",
    "fields": [
      { "fieldname": "title",    "fieldtype": "Data",   "reqd": true, "in_list_view": true },
      { "fieldname": "status",   "fieldtype": "Select", "options": "Open\nDone", "default_value": "Open", "in_list_view": true },
      { "fieldname": "due_date", "fieldtype": "Date",   "in_list_view": true },
      { "fieldname": "priority", "fieldtype": "Select", "options": "Low\nMedium\nHigh", "default_value": "Medium" }
    ]
  }'
```

The field shape (`fieldname`, `fieldtype`, `options`, `reqd`, `unique`,
`default_value`, `in_list_view`, `permlevel`, ...) is validated by
`doctypeDefSchema` in `apps/server/src/doctype-engine.ts`. Compare with the
canonical definitions in the metadata migrations —
`apps/server/migrations/0022_todo.ts` (ToDo) and
`apps/server/migrations/0036_workspace.ts` (Workspace) use exactly this
shape via `createDocType`.

## 3. Watch the table appear

`createDocType` generated a real Postgres table. Look at it:

```bash
psql "postgres://postgres:postgres@127.0.0.1:5432/featherbase" -c '\d tab_task'
```

You'll see your four columns plus the standard columns every generated table
gets — `name` (primary key), `owner`, `creation`, `modified`, `modified_by`,
`docstatus`, `idx` (`STANDARD_COLUMNS` and `createTableDDL` in
`apps/server/src/doctype-engine.ts`). The metadata itself landed as rows in
`tab_doctype` and `tab_docfield`. The table also has row-level security
enabled with a generated read policy for the `desk_client` role.

## 4. Use the generated UI

Open **http://localhost:5173/desk/Task**. The generic `ListView`
(`apps/web/src/components/ListView.tsx`) renders your list-flagged columns —
no Task-specific frontend code exists anywhere.

Create a task: a new document lives at **`/desk/Task/new`** (the literal
name `new` renders an empty `FormView` —
`apps/web/src/components/FormView.tsx`). Fill in a title and save; the form
POSTs to `/api/save_doc` and the naming series assigns `TASK-0001`.

Create a few more. Then try the HTTP equivalent:

```bash
curl -s http://localhost:8000/api/save_doc \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"doctype":"Task","doc":{"title":"Read ARCHITECTURE.md","due_date":"2026-08-01"}}'
```

The response is the saved document, with `name`, `status: "Open"` (your
default), and audit columns filled in.

To **complete** a task over HTTP you must echo the `modified` timestamp you
loaded — updates are optimistically locked (`updateDoc` in
`apps/server/src/document.ts` rejects a stale `modified` with a 409):

```bash
DOC=$(curl -s http://localhost:8000/api/resource/Task/TASK-0001 \
  -H "Authorization: Bearer $TOKEN")
MOD=$(echo "$DOC" | jq -r .modified)

curl -s http://localhost:8000/api/save_doc \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"doctype\":\"Task\",\"doc\":{\"name\":\"TASK-0001\",\"modified\":\"$MOD\",\"status\":\"Done\"}}"
```

In the Desk the form does this for you. Filter the list to open tasks: the
list's filters live in the URL (`/desk/Task?filters=...`), so a filtered
view is shareable.

## 5. Add a validation — without redeploying

Let's enforce a rule: a task's title must be at least five characters.
**Server Scripts** are documents too (defined in
`apps/server/migrations/0037_server_script.ts`, executed by
`apps/server/src/server-scripts.ts` in a hardened `node:vm` sandbox inside
the save transaction).

Create one at `/desk/Server Script/new` (or via `save_doc`):

- **name**: `task-title-length` (Server Script uses prompt naming)
- **script_type**: `Document Event`
- **reference_doctype**: `Task`
- **event**: `validate`
- **script**:

  ```js
  if (!doc.title || doc.title.length < 5) {
    frappe.throw('Title must be at least 5 characters')
  }
  ```

- **enabled**: checked

The script sees the document as `doc` and can call `frappe.throw(message)`
to abort the save (the sandbox exposes nothing else — no `process`, no
`fetch`). Now try saving a task titled "x": the save fails with a 417
validation error, in the Desk and over HTTP alike, because the script runs
inside `saveDoc` itself.

If you'd rather gate status changes by role, look at **Workflow**
(`apps/server/migrations/0015_workflow.ts`,
`apps/server/src/workflow.ts`): a Workflow document ties states and
role-gated transitions to a DocType, and the form grows action buttons via
`/api/workflow/:doctype/:name`. That's a good second exercise.

## 6. Compare with the reference solution

Open `/desk/ToDo` — the built-in equivalent. Its definition in
`apps/server/migrations/0022_todo.ts` is a superset of what you built:
`allocated_to` is a **Link** field to `User`, and
`reference_doctype`/`reference_name` let a ToDo point at any document (this
is what `/api/assign` creates). Link fields get you referential integrity
for free — the save path verifies the target row exists (`validateLinks` in
`apps/server/src/document.ts`), and deletion of a linked document is
blocked.

## 7. Stretch: write a sandboxed test

Server tests run against the real Postgres inside a rolled-back transaction
(see [TESTING.md](TESTING.md)). Model yours on
`apps/server/test/naming.test.ts`. Create
`apps/server/test/task-tutorial.test.ts`:

```ts
import { describe, expect } from 'vitest'
import { test } from './pg-test'

describe('Task tutorial', () => {
  test('creates tasks with series names and the status default', async ({ admin }) => {
    await admin.post('/api/doctype', {
      name: 'Tutorial Task',
      autoname: 'TUT-.####',
      fields: [
        { fieldname: 'title', fieldtype: 'Data', reqd: true },
        { fieldname: 'status', fieldtype: 'Select', options: 'Open\nDone', default_value: 'Open' },
      ],
    })
    const doc = await admin.post<{ name: string; status: string }>('/api/save_doc', {
      doctype: 'Tutorial Task',
      doc: { title: 'Write the tutorial' },
    })
    expect(doc.name).toBe('TUT-0001')
    expect(doc.status).toBe('Open')
  })
})
```

Run just this file:

```bash
pnpm --filter server test test/task-tutorial.test.ts
```

Two things worth noticing. The DocType is named `Tutorial Task`, not `Task`:
the test's transaction rolls back, but it still *sees* committed state, so
reusing the `Task` you created earlier would make `/api/doctype` answer 409.
And asserting `TUT-0001` is safe precisely because the series counter row is
created inside the rolled-back transaction — every run starts the series
fresh.

## Where to go next

- [ARCHITECTURE.md](ARCHITECTURE.md) traces exactly what happened on each of
  your saves.
- [GLOSSARY.md](GLOSSARY.md) decodes the Frappe vocabulary you just used.
- Try `permissions/Task` in the Desk to grant a non-admin role access, then
  log in as a second user.
