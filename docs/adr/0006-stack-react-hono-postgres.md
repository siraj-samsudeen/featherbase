# ADR 0006: React + Hono + Postgres

**Status:** Accepted · **Date:** 2026-07-21 · **Supersedes:** [0001](0001-stack-convex-react-vite.md), [0002](0002-storage-per-doctype-tables-plus-fieldindex-sidecar.md), [0003](0003-definitions-as-json-two-sources.md), [0004](0004-materialization-admin-triggered.md)

## Context

[ADR 0001](0001-stack-convex-react-vite.md) chose Convex, and ADRs 0002–0004 built
storage, definition, and materialization decisions on top of it. That line of work
reached capability 4 (sign-in) before a parallel experiment — a from-scratch
implementation on React + Hono + Postgres, developed under the working name
`frappe-clone` — overtook it.

The parallel implementation is further along on every axis that matters:

- **Frappe wire-format compatibility.** Sessions ride an HttpOnly `sid` cookie
  alongside a Bearer token, `POST /api/method/login` and `/logout` are
  Frappe-shaped, error bodies carry Frappe's `exc_type`, and the `frappe.client.*`
  RPC namespace is implemented. Replicating Frappe means matching its wire
  format, which is far more natural against a SQL backend.
- **A real test story.** A 320-test server suite and a component suite run
  against actual Postgres using per-test transaction rollback, extracted as
  [feather-testing-postgres](https://github.com/siraj-samsudeen/feather-testing-postgres).
  This delivers the deterministic-testing requirement from ADR 0001 without
  depending on a vendor-specific in-memory backend.
- **Metadata-driven storage on SQL.** DocTypes map onto Postgres tables directly,
  which is what Frappe does and what ADR 0002's per-DocType tables plus a
  `fieldIndex` sidecar were approximating on a document store.

The decisive point is that Featherbase's goal is to replicate Frappe's core ideas.
Frappe is built on a relational database, and its metadata engine, query builder,
and permission model all assume one. Reimplementing that on a document store meant
paying translation costs on every feature.

## Decision

Featherbase is built on **React + Hono + Postgres**, as a pnpm workspace:

| Workspace | Role |
|---|---|
| `apps/server` | Hono API — DocType engine, Frappe-compatible REST/RPC, auth |
| `apps/web` | React Desk UI — metadata-driven grid, form, and detail views |
| `packages/shared` | Types and contracts shared across server and web |
| `packages/feather-testing-postgres` | SQL Sandbox test harness (also published standalone) |

> *Update 2026-07-22:* `packages/feather-testing-postgres` was extracted to
> [its own repo](https://github.com/siraj-samsudeen/feather-testing-postgres)
> and is now consumed as a published npm dependency; it is no longer a
> workspace package.

The Convex implementation is retired. Its history is preserved on the
`archive/convex-v1` tag, and its capability specs live under
[docs/archive/convex-capabilities/](../archive/convex-capabilities/).

## Consequences

**Gained.** Direct Frappe parity on wire format and data model; a test approach
that exercises the production code path against a real database; no vendor
lock-in on the backend; SQL as an escape hatch for anything the metadata engine
does not yet cover.

**Lost.** Convex's built-in reactivity, which ADR 0001 valued for Glide-style
computed data. Reactive/computed fields must now be designed explicitly rather
than inherited from the platform, and durable workflow execution — ADR 0001's
third requirement — is unsolved on this stack and remains open.

**Retained.** [ADR 0005](0005-naming-featherbase.md) (the name) is unaffected,
as is the vision in [VISION.md](../VISION.md) and the research in
[research/](../research/), all of which are stack-independent.
