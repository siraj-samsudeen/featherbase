# ADR 0006: React + Hono + Postgres

**Status:** Accepted · **Date:** 2026-07-21 · **Corrected:** 30-Oct-2026 (#705) · **Supersedes:** ADRs 0001–0004, the Convex line (deleted 30-Oct-2026; see git history)

> **30-Oct-2026 correction.** This text now folds in the 2026-07-22 update and
> the terminology addendum (#59/#61) instead of carrying them as notes, and
> drops the links to ADRs 0001–0004, which were deleted in #705 because
> nothing current depends on them. Frappe wire-format compatibility, which the
> original text counted as a gain, is no longer a goal.

## Context

The first line of work chose Convex (ADR 0001) and built storage, definition
and index-materialization decisions on top of it (ADRs 0002–0004). It reached
sign-in before a parallel experiment, a from-scratch implementation on
React + Hono + Postgres, overtook it.

The parallel implementation was further along where it mattered:

- **A real test story.** The server and component suites run against actual
  Postgres using per-test transaction rollback, extracted as
  [feather-testing-postgres](https://github.com/siraj-samsudeen/feather-testing-postgres).
  This gives deterministic tests without depending on a vendor-specific
  in-memory backend.
- **Metadata-driven storage on SQL.** Each Table maps onto a Postgres table
  directly, which the Convex design could only approximate with per-table
  documents plus a separate index table.

The project then aimed to replicate Frappe's core ideas, and Frappe is built on
a relational database: its metadata engine, query builder and permission model
all assume one. Reimplementing that on a document store meant paying
translation costs on every feature.

## Decision

Featherbase is built on **React + Hono + Postgres**, as a pnpm workspace:

| Workspace | Role |
|---|---|
| `apps/server` | Hono API: the Table engine, the action API, auth |
| `apps/web` | React Admin UI: metadata-driven grid, form and detail views |
| `packages/shared` | Types and contracts shared across server and web |
| `runtime-apps/` | Apps installed on an instance, such as Tasker |

The test harness `feather-testing-postgres` lives in
[its own repository](https://github.com/siraj-samsudeen/feather-testing-postgres)
and is consumed as a published npm dependency.

The Convex implementation is retired. Its history is preserved on the
`archive/convex-v1` tag.

## Consequences

**Gained.** A data model close to Frappe's relational one; a test approach that
exercises the production code path against a real database; no vendor lock-in
on the backend; SQL as an escape hatch for anything the metadata engine does
not yet cover.

**No longer a goal.** Frappe wire-format compatibility. Frappe's vocabulary
(DocType, Doc, Field) has been replaced by Featherbase's own (Table, Row,
Column and more), and the API is built around one action registry rather than
Frappe's REST/RPC shape. [CONTEXT.md](../../CONTEXT.md) is the source of truth
for the vocabulary.

**Lost.** Convex's built-in reactivity and its durable workflow engine. Live
updates, background and scheduled jobs, and approval workflows had to be built
explicitly on Postgres instead of being inherited from the platform; their
behaviour lives in `openspec/specs/`.

**Retained.** [ADR 0005](0005-naming-featherbase.md) (the name) and the vision
in [VISION.md](../VISION.md) are unaffected.
