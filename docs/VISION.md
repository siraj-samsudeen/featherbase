# Vision

## The one-liner

A free and open-source GlideOS: describe an app in chat, drop an Excel file, or write a config file — get a working, tested, production-grade business app in minutes, then iterate. Built on a metadata-driven core (Frappe's best idea) with a modern TypeScript stack, and differentiated by something no closed AI app builder can offer: **every generated artifact is machine-validated and covered by 100% automated tests before a human ever reviews it.**

## Who it's for

**Developers first.** The goal is that a developer covers ~80% of a business system's requirements using:

1. **Configuration options** — DocTypes defined as JSON, synced on deploy
2. **Excel drag-and-drop** — users hand over the spreadsheets they already run the business on; the schema is inferred, previewed, approved, imported
3. **An AI coding-agent chat** — generating most of the artifacts (DocTypes, flows, layouts, seed data)

The site goes up fast; iteration happens from there. End users get a second mode: creating their own master/lookup tables at runtime in production, without acting like developers.

## Why (the Frappe lessons)

We ran production systems on Frappe. What we keep and what we fix:

**Keep (Frappe's genius):**
- The DocType metadata system — schema and UI as one artifact, driving everything (tables, forms, lists, API, permissions)
- Document lifecycle events as a universal automation bus
- Customize-without-forking (layered overrides as data)
- Real physical table per DocType — developer-defined and user-created tables get identical treatment

**Fix (the pain):**
- **The promotion path.** Users start runtime tables, hit complexity, and need to convert them to code. Frappe offers this exit but it was buggy and unreliable. In Featherbase, promotion is a metadata/codegen change with **zero data movement**, testable as a round-trip property. This is a design invariant, not a feature.
- The fragmented automation story (five doctypes, five condition syntaxes, five log locations) — replaced by one Flow object with Glide's three-primitive grammar (Action / Loop / Condition) on a durable execution substrate
- The dated UI stack and Python/bench operational weight — replaced by React + Vite + Convex
- Developer-facing-only logs — replaced by builder-facing run history with inspectable per-step payloads

## What Glide proved (and where we go past it)

Glide proved: radical vocabulary reduction (trigger → action/loop/condition), UI actions and backend automations as one continuum, computed columns as a reactive derived-data layer, "default to working" auto-generated UI, one-toggle row-level security, and — with GlideOS (2026) — the agentic chat authoring loop from a spreadsheet, prompt, or file.

Glide's gaps we deliberately close: no retries/error handling in workflows, no versioning, closed source, lock-in, **and no testing story**. Our AI loop is: generate artifacts → JSON-schema validation → apply to an ephemeral in-memory test site → auto-generated tests run → preview → approve → commit. That loop is only possible because every artifact is data — and it is the moat.

## Non-negotiable invariants

1. **DocType metadata and flow definitions are portable JSON documents** — never backend-specific artifacts. These are the crown jewels.
2. **All record access goes through one repository layer** keyed on DocType metadata — the only seam that would ever need re-implementing on another backend.
3. **Promotion never moves data.** Any rung of the ladder (runtime → materialized → package) is a metadata/codegen change, independently reversible, round-trip tested.
4. **100% automated testing** per the feather testing philosophy (MECE states, integration-first, test matrix before code). Coverage is the floor; review is the ceiling.
