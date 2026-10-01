# Featherbase Architecture

> Status: **DRAFT** — living design doc. Sections marked _(open)_ are undecided.
> Last updated: 2026-10-01

## 1. What Featherbase is

Drop an Excel file, get a working app: database tables, a REST API, and a
spreadsheet-like UI for viewing and editing the data — plus the typical Excel
workflows (sort, filter, bulk edit, re-import, export).

It offers **two modes over the same definition of the data**:

| Mode | Feels like | Who it's for |
|---|---|---|
| **Runtime** | NocoDB, Baserow, Airtable | Anyone. Upload a file, tables and APIs exist instantly. No code. |
| **Scaffold** | `rails generate scaffold`, Frappe developer mode | Developers. Generate real source code they own, edit, and version-control. |

A table starts life in runtime mode and can be "promoted" to scaffold mode when
its owner needs custom logic the generic engine can't express.

## 2. Goals and non-goals

**Goals**
- Learn Elysia and Bun deeply by building the core by hand.
- Prefer established, reliable libraries over rewriting — as long as they are
  not bloated and fit the design.
- Small core, everything else a plugin (NocoBase model).
- One source of truth for every table's shape.

**Non-goals (for now)**
- Formula engine compatible with Excel.
- Real-time multi-user collaborative editing.
- Running on Node — Bun only.

## 3. Core idea: metadata is the source of truth

Every table is described by a **table definition** — a JSON document listing its
fields, their types, and rules. Everything else is derived from it:

```
                  ┌──────────── Table definitions (metadata JSON) ─────────────┐
 Excel upload ───►│  stored in DB   ◄── sync in developer mode ──►  files in repo │
                  └──────────┬─────────────────────────────────────────┬────────┘
                             │                                         │
                    RUNTIME MODE                               SCAFFOLD MODE
                    generic routes  /api/:table                generator writes code:
                    validation built from metadata             Elysia plugin, types,
                    dynamic SQL queries                        UI pages → developer edits
                             │                                         │
                             └──────── Core (Elysia) + Plugins ────────┘
```

Inspirations:
- **Frappe** — DocTypes live in the DB *and* as `doctype.json` files in developer
  mode; optional `doctype.py` overrides default behaviour.
- **Twenty CRM** — `Object` / `Field` metadata tables; API schema is computed from
  metadata and cached.
- **Strapi** — content-type builder writes `schema.json` files in dev mode and
  restarts.

### 3.1 Table definition (sketch) _(open)_

```jsonc
{
  "name": "customers",            // table name, URL segment
  "label": "Customers",
  "source": { "file": "crm.xlsx", "sheet": "Customers" },
  "fields": [
    { "name": "id",    "type": "id" },
    { "name": "name",  "type": "text",   "required": true },
    { "name": "email", "type": "email",  "unique": true },
    { "name": "joined","type": "date" },
    { "name": "spend", "type": "number", "precision": 2 }
  ],
  "mode": "runtime"               // or "scaffold"
}
```

Open questions:
- Exact field type list, and how each maps to SQL, TypeBox, and the UI.
- How relations between sheets are expressed.
- Versioning of definitions (needed for migrations).

## 4. Runtime mode

**No route reloading.** Instead of registering `/customers`, `/orders`, … as
separate routes, the core registers a fixed set of generic routes:

```
GET    /api/:table          list (filter, sort, paginate)
GET    /api/:table/:id      read one
POST   /api/:table          create
PATCH  /api/:table/:id      update
DELETE /api/:table/:id      delete
```

Each request:
1. Looks up `:table` in an in-memory **registry** of table definitions.
2. Validates input against a TypeBox schema **built from the definition**
   (Elysia's `t` is runtime JSON Schema, so this works for tables created after
   startup).
3. Runs a query built dynamically with Kysely.

Adding or changing a table updates the database schema (DDL) and refreshes the
registry. The server never restarts.

Open questions _(open)_:
- How per-table schemas appear in the OpenAPI docs when routes are generic.
- Storage of user data: one real SQL table per sheet (current preference — fast,
  queryable) vs. JSON rows in a shared table (simpler, slower).

## 5. Scaffold mode _(open — later phase)_

A generator turns a table definition into source files a developer owns, e.g.:

```
src/tables/customers/
  customers.plugin.ts    # Elysia plugin with typed routes
  customers.schema.ts    # TypeBox / Kysely types
  customers.hooks.ts     # developer-owned: before/after create, update, …
ui/tables/customers/...  # generated pages
```

- When a table has generated code, that code **overrides** the generic engine for
  that table (like Frappe's `doctype.py`).
- Reload in development via `bun --watch`.
- Candidate: generate a ZenStack `.zmodel` and use ZenStack v3 for the typed ORM,
  access policies and frontend hooks. Not usable for runtime mode today
  (runtime-defined models are an open feature request).

Open questions:
- Regenerate vs. hand-edit conflicts: which files are always regenerated, which
  are generated once and then owned by the developer?
- Code generation approach: template strings vs. an AST library (ts-morph).

## 6. Core and plugins

Modelled on NocoBase's microkernel: the core only handles plugin lifecycle,
dependencies, and shared services; features are plugins.

- **Plugin unit:** an Elysia plugin (named, de-duplicated, scoped hooks).
- **Plugin shape** _(open)_: possibly a Payload-style function that receives and
  returns configuration, plus an optional Elysia plugin for routes.
- **Lifecycle** _(open)_: install → enable → load → disable → uninstall
  (from NocoBase).

Likely first plugins: `excel-import`, `excel-export`, `openapi`, `auth`, `ui`.

## 7. Technology choices

| Concern | Choice | Status |
|---|---|---|
| Runtime | Bun | decided |
| HTTP framework | Elysia | decided |
| Validation | Elysia `t` (TypeBox) | decided |
| Database (dev) | SQLite via `bun:sqlite` | proposed |
| Database (prod) | Postgres via `Bun.sql` | proposed |
| Query builder | Kysely (dynamic + typed) | proposed |
| Meta tables ORM | Kysely, or ZenStack v3 | open |
| Excel read | SheetJS | proposed |
| Excel write | ExcelJS | proposed |
| API docs | `@elysiajs/openapi` | proposed |
| Frontend | framework + grid library | open |
| Typed client | Eden Treaty (static parts) | proposed |
| Tests | `bun:test` | proposed |

## 8. Learning roadmap

| # | Phase | Elysia/Bun concepts | Outcome |
|---|---|---|---|
| 0 | Tooling | Bun, `bun create elysia` | ✅ project skeleton |
| 1 | Hello server | `new Elysia()`, routes, handlers, context | server responds |
| 2 | Hand-written CRUD (one fixed table) | params, body, `t` validation, status, errors, `bun:sqlite` | what generated code must eventually look like |
| 3 | Structure | plugins, `group`, `decorate`, `state`, `derive`, lifecycle hooks | core + plugin skeleton |
| 4 | Metadata + generic engine | TypeBox built at runtime, Kysely | runtime mode for hand-written definitions |
| 5 | Excel import | `t.File`, SheetJS, type inference | upload → definition → table |
| 6 | API docs + tests | `@elysiajs/openapi`, `bun:test` | documented, tested |
| 7 | Frontend | static/html, Eden | grid UI |
| 8 | Excel workflows | streaming responses | sort/filter/bulk edit/re-import/export |
| 9 | Scaffold mode | code generation, `bun --watch` | `featherbase generate` |
| 10 | Auth + permissions | JWT, guards, `derive` | multi-user |

## 9. References to study

- NocoBase — plugin lifecycle and microkernel: https://v2.docs.nocobase.com/plugin-development
- Twenty — metadata engine: https://docs.twenty.com/developers/backend-development/custom-objects
- Frappe — DocTypes and developer mode
- Payload CMS — config-as-code plugins
- ZenStack v3 — https://zenstack.dev/docs (runtime models: zenstackhq/zenstack-v3#414)

## 10. Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-10-01 | Bun + Elysia | Learning goal |
| 2026-10-01 | Metadata as single source of truth, two modes | Runtime convenience + developer ownership, à la Frappe |
| 2026-10-01 | Generic routes, no runtime route registration | Avoids reloading routes; proven by Twenty/NocoBase |
| 2026-10-01 | Don't build on ZenStack yet | No runtime models; would hide the Elysia layer we want to learn |
