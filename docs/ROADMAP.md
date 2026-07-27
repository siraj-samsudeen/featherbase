# Featherbase — Strategy & Roadmap

Featherbase's history has two phases:

- **Phase 1 — replicate.** Goal: replicate the features of [Frappe
  Framework](https://frappe.io/framework) ([source](https://github.com/frappe/frappe))
  on a modern JS/TS stack. This phase is **done** — the metadata engine, the
  generic Admin UI, permissions, workflows, and the rest of the platform
  described below were built by studying and reproducing Frappe's design.
- **Phase 2 — diverge.** Now that replication succeeded, the project is
  deliberately moving away from Frappe's design where it doesn't hold up for
  this platform's own users — starting with vocabulary (Frappe's DocType,
  Doc, Field, permlevel, and friends are gone; see
  [GLOSSARY.md](GLOSSARY.md)) and extending to the API shape (a unified
  action registry replacing the Frappe-compatible REST/RPC surface; see
  [ADR 0006](adr/0006-stack-react-hono-postgres.md)'s addendum). Frappe wire
  compatibility is no longer a goal.

The rest of this document is a historical record of the Phase 1 strategy and
sequencing. Read it as "how we got here," not as the current target shape —
the vocabulary throughout has been updated to Featherbase's own terms, but
the stack and phasing described are the original plan.

> **Status (2026-07): the stack described below is superseded.** The
> "React + Supabase" choice was never implemented — the project went to
> Convex ([ADR 0001](adr/0001-stack-convex-react-vite.md)), then to the
> current **React + Hono + Postgres** stack
> ([ADR 0006](adr/0006-stack-react-hono-postgres.md)). Read the Supabase
> mapping table as historical; the phased build plan below remains the
> sequencing guide, with each Supabase-provided capability satisfied by a
> local equivalent (native RLS, server-issued JWTs, server websockets,
> disk-backed storage).

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

## The core insight: Table (metadata-driven everything)

A Table is a JSON description of a model — Frappe calls this a "DocType."
From that single JSON, Frappe (and now Featherbase) auto-generates:

- the database table (and migrations when the JSON changes)
- the lifecycle/hook layer (on-check, before-saving, on-submit, ...)
- a full REST API over every Table
- the admin UI (list view, form view, filters) with zero frontend code
- permission checks (role-based, row-level, column-level)

Even Tables are stored as a Table. Replicating this engine correctly yielded
~60% of Frappe's functionality; skipping it would have meant never
converging.

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
| Auto REST API (per-Table) | PostgREST (automatic per-table REST) — read path only, see caveat |
| Auth (sessions, API keys, social login) | Supabase Auth |
| Permissions engine | Postgres RLS policies, **generated from Table metadata** |
| Realtime (Socket.IO + Redis) | Supabase Realtime |
| File attachments | Supabase Storage |
| Background jobs (RQ + Redis) | pgmq / pg_cron (or Trigger.dev / Inngest later) |
| Email queue | Resend (or similar) + pgmq |
| Admin SPA | React + Vite, TanStack Router + Query, Tailwind + shadcn/ui |
| Form rendering/validation | react-hook-form + zod, **zod schemas generated from Table metadata** |
| Jinja print formats | React-to-PDF or Puppeteer print routes |

### The critical caveat: writes must go through the row engine

Frappe routes every write through its `Document` class so lifecycle hooks
(validate, before_save, on_submit, server scripts) always run. Raw
PostgREST inserts/updates bypass any such layer. So:

- **Reads / list views**: PostgREST directly (fast, free, RLS-protected).
- **Writes**: a single row-save endpoint (Supabase Edge Function, or a small
  Node service — Hono/Fastify — pointed at the same Postgres) that loads the
  Table metadata, runs the automation-trigger chain, validates, then writes.
- **DDL** (creating/altering tables when a Table changes): a `security
  definer` Postgres function invoked by the metadata engine.

Start with Edge Functions; if/when the hook system grows (server scripts,
app plugins), graduate to a dedicated Node service — Supabase is plain
Postgres, so an external API server attaches cleanly.

### What you still build yourself (the actual project)

1. The Table metadata engine: JSON schema, storage (a `table_def` table),
   DDL generation + diffing, id patterns, sub-tables.
2. The row lifecycle/automation-trigger chain in TypeScript.
3. RLS-policy generation from Table permission metadata.
4. The generic Admin UI: metadata-driven list/form/reference-column components.

## Phased build plan

### Phase 1 — Metadata engine (foundation; spend the most time here)
- Table JSON schema definition
- Dynamic table creation + schema diffing/migration on metadata change
- Row lifecycle class with the automation-trigger chain
- Id patterns (`hash`, series like `INV-.####`)
- Sub-tables (one-to-many modeled as nested rows)

### Phase 2 — Auto REST API + permissions
- Generic CRUD endpoints driven by metadata
- Session + API-key/token auth
- Permission engine: role permissions per Table/action, per-user (row-level)
  Data Scopes, column-level tiers

### Phase 3 — Auto admin UI
- SPA that fetches Table metadata and renders list/form views generically
- Reference columns (foreign-key autocomplete), filters, sorting
- One generic codebase renders every model

### Phase 4 — Platform services
- Background jobs + scheduler
- Realtime updates (websocket + Redis pub/sub)
- Email sending/queue, notifications
- File attachments

### Phase 5 — Power features
- Report builder (saved list configurations); SQL/Code Reports
- PDF Templates + PDF generation
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
