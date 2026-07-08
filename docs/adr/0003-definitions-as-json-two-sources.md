# ADR 0003: Definitions are JSON with two sources (package | site)

**Status:** Accepted · **Date:** 2026-07-08

## Context

Two authoring modes are required. **Mode 1 (developer):** DocTypes defined as config files in a git-tracked app package, applied on deploy — plus Excel-drop and AI-chat generation targeting the same files. **Mode 2 (runtime):** production users create master/lookup tables at user level through the UI, no developer skills expected.

The critical failure to avoid, learned from Frappe: users start runtime tables, hit complexity, need to "convert to code" — and Frappe's export machinery (module assignment, fixtures, Custom Field/Property Setter overlays) was buggy and unreliable.

## Decision

1. **One canonical artifact format: JSON.** Every DocType is a JSON document validated against a published JSON Schema. (JSON over YAML: round-trip fidelity and schema validation matter more than hand-editability, since files are mostly written by the UI, the Excel importer, or the AI agent — the same call Frappe made.)
2. Each definition carries `source: "package"` (file in git, synced to the site on deploy, with drift detection) or `source: "site"` (row in the database, created at runtime).
3. **Package mode gets full codegen:** DocType JSON → generated `schema.ts` entry (typed validator + native indexes) + TypeScript types + typed repository accessors + lifecycle-hook stubs (`validate`, `beforeSave`, …). Applied hot by `convex dev` on save; by `convex deploy` in production. Generated files are never hand-edited.
4. **Site mode gets declarative power only:** validations + Flows, no code hooks. Attaching code requires promotion to a package.
5. **Promotion = serialize the same JSON to a package file, flip `source`, run codegen.** Demotion is the reverse. Zero data movement (ADR 0002). The round-trip (DB → file → DB) must be byte-identical — enforced as a property test, forever.
6. An **app package** is a folder: `doctypes/*.json`, `flows/*.json`, `layouts/*.json`, `seeds/*`, `hooks/*.ts`. This is the unit the AI agent reads and writes — the agent edits validated JSON artifacts, never raw framework code.

## Consequences

- Definition-to-git promotion and index materialization (ADR 0004) are **independent axes** — a table can gain native indexes while remaining site-owned, or move to git without materializing, or both.
- The AI authoring loop becomes machine-checkable end-to-end: generate → JSON-schema validate → apply to ephemeral in-memory test site (`convex-test`) → run generated tests → preview → approve → commit.
- Excel import is an *authoring input*, not a storage concern: infer columns → types/enums/relation suggestions → preview → approve → emits a DocType JSON (+ seed data) into whichever source the actor is working in.

## Alternatives rejected

- **Everything-is-code-always** (GlideOS/Chef pattern: runtime edits trigger programmatic deploys via Convex's Management API): maximal git purity, but a production ERP user adding a lookup table must not trigger a code deployment, and mode 2 would disappear. We keep its *agent loop* at the artifact level only.
- **YAML canonical:** worse round-trip guarantees, no benefit for machine-authored files.
