# Frappe Framework Replication — Strategy & Roadmap

Goal: replicate the features of [Frappe Framework](https://frappe.io/framework)
([source](https://github.com/frappe/frappe)).

## Strategic options

Frappe is ~1M lines of code built over 15+ years. Pick the goal before picking
the stack:

| Goal | Right approach | Effort |
|---|---|---|
| Ship the product | Fork `frappe/frappe` (MIT-licensed), white-label, customize | Weeks |
| Learn the architecture | Build a "mini-Frappe" replicating the core engine | Months |
| Frappe's ideas in another stack | Rebuild the metadata engine, skip the long tail | Months+ |

Note: MIT license permits full replication and forking; the "Frappe" name and
logo are trademarks and cannot be reused.

## The core insight: DocType (metadata-driven everything)

A DocType is a JSON description of a model. From that single JSON, Frappe
auto-generates:

- the database table (and migrations when the JSON changes)
- the ORM class with lifecycle hooks (`validate`, `before_save`, `on_submit`, ...)
- a full REST API (`/api/resource/<DocType>`)
- the admin UI (list view, form view, filters) with zero frontend code
- permission checks (role-based, row-level, field-level)

Even DocTypes are stored as a DocType. Replicating this engine correctly yields
~60% of Frappe's functionality; skipping it means never converging.

## Frappe's architecture

- **Backend**: Python, Werkzeug WSGI, Jinja templating
- **Data**: MariaDB/Postgres; Redis ×3 (cache, job queue, realtime pub/sub)
- **Jobs**: RQ workers + cron-like scheduler
- **Realtime**: Node.js Socket.IO server bridged via Redis
- **Frontend**: Desk SPA (custom JS framework); Frappe UI (Vue 3 + Tailwind) for newer apps
- **Platform**: `bench` CLI, multi-tenant sites, installable apps via `hooks.py`

## Chosen stack: JS/TS — React + Supabase

Supabase covers a surprising amount of Frappe's platform layer out of the box:

| Frappe subsystem | JS-stack equivalent |
|---|---|
| MariaDB | Supabase Postgres |
| Auto REST API (`/api/resource/*`) | PostgREST (automatic per-table REST) — read path only, see caveat |
| Auth (sessions, API keys, social login) | Supabase Auth |
| Permissions engine | Postgres RLS policies, **generated from DocType metadata** |
| Realtime (Socket.IO + Redis) | Supabase Realtime |
| File attachments | Supabase Storage |
| Background jobs (RQ + Redis) | pgmq / pg_cron (or Trigger.dev / Inngest later) |
| Email queue | Resend (or similar) + pgmq |
| Desk SPA | React + Vite, TanStack Router + Query, Tailwind + shadcn/ui |
| Form rendering/validation | react-hook-form + zod, **zod schemas generated from DocType metadata** |
| Jinja print formats | React-to-PDF or Puppeteer print routes |

### The critical caveat: writes must go through the Document engine

Frappe routes every write through the `Document` class so lifecycle hooks
(`validate`, `before_save`, `on_submit`, server scripts) always run. Raw
PostgREST inserts/updates bypass any such layer. So:

- **Reads / list views**: PostgREST directly (fast, free, RLS-protected).
- **Writes**: a single `save_doc` endpoint (Supabase Edge Function, or a small
  Node service — Hono/Fastify — pointed at the same Postgres) that loads the
  DocType metadata, runs the hook chain, validates, then writes.
- **DDL** (creating/altering tables when a DocType changes): a `security
  definer` Postgres function invoked by the metadata engine.

Start with Edge Functions; if/when the hook system grows (server scripts,
app plugins), graduate to a dedicated Node service — Supabase is plain
Postgres, so an external API server attaches cleanly.

### What you still build yourself (the actual project)

1. The DocType metadata engine: JSON schema, storage (a `doctype` table),
   DDL generation + diffing, naming series, child tables.
2. The document lifecycle/hook chain in TypeScript.
3. RLS-policy generation from DocType permission metadata.
4. The generic Desk UI: metadata-driven list/form/link-field components.

## Phased build plan

### Phase 1 — Metadata engine (foundation; spend the most time here)
- DocType JSON schema definition
- Dynamic table creation + schema diffing/migration on metadata change
- `Document` class with lifecycle hook chain
- Naming rules (autoname, series like `INV-.####`)
- Child tables (one-to-many modeled as nested documents)

### Phase 2 — Auto REST API + permissions
- Generic CRUD endpoints driven by metadata
- Session + API-key/token auth
- Permission engine: role perms per DocType/action, user (row-level) perms,
  field-level read/write

### Phase 3 — Auto admin UI ("Desk")
- SPA that fetches DocType metadata and renders list/form views generically
- Link fields (foreign-key autocomplete), filters, sorting
- One generic codebase renders every model

### Phase 4 — Platform services
- Background jobs + scheduler
- Realtime updates (websocket + Redis pub/sub)
- Email sending/queue, notifications
- File attachments

### Phase 5 — Power features
- Report builder (saved list configurations); query/script reports
- Print formats + PDF generation
- Workflow engine (states, transitions, approvals)
- Customization layer: Custom Fields, client/server scripts (stored as data)
- Webhooks

### Phase 6 — Platform-ification
- Multi-tenant sites
- App/plugin system with hooks
- CLI (`bench` equivalent)
- Fixtures, patch-based migrations, translations
- Website/portal module

## Studying the original

Run real Frappe first (`bench init`, build a toy app), then read in
`frappe/frappe`:

- `frappe/model/document.py`, `frappe/model/base_document.py` — ORM + lifecycle
- `frappe/model/meta.py` — metadata loading/caching
- `frappe/core/doctype/doctype/doctype.py` — how DocTypes create/alter tables
- `frappe/handler.py`, `frappe/api/` — request dispatch + auto REST API
- `frappe/permissions.py` — permission engine
- `hooks.py` resolution in `frappe/__init__.py` — the app system

## Recommended MVP

Phases 1–3: metadata engine, auto REST API, auto admin UI. Realistic as a
2–3 month solo project, and it is the architecturally interesting part of
Frappe. Everything later is accretion on top of that engine.
