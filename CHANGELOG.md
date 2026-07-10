# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Pre-PR preflight gate (`npm run preflight`): the full CI battery plus the Playwright E2E suite, enforced by a project-shared Claude Code hook that blocks PR creation until preflight is green on the exact working tree (`.claude/settings.json`, `scripts/preflight.sh`, `scripts/check-preflight.sh`) (#22)
- Playwright E2E suite (`npm run test:e2e`): 16 real-browser journeys — real anonymous sign-in with real JWTs, tasks demo, designer, grid sort/filter, record create/edit/delete, and the full zero-code tracer — against an anonymous local Convex deployment that the suite boots and auth-provisions itself (`docs/e2e-testing.md`) (#22)
- Sign-in: real authentication via Convex Auth (pinned 0.0.90), anonymous-first — one-click "Get started", sign-out in the shell; identity flows through the `requireUser` seam (`getAuthUserId`, so ownership doesn't fragment per session) and the schema adopts `authTables` (#22)
- Auth-gated app shell: unauthenticated visitors get the sign-in state (never a hang), auth-pending shows loading, the nav and views render only once Convex confirms the identity (#22)
- Query-error states: `DoctypeList`, `DoctypeGate`, `RecordGrid`, and `RecordDetail` show the error inline instead of a perpetual "Loading…"; failed deletes surface on the detail view (#13)
- 14-row capability-4 test matrix including the sign-in tracer bullet (gate → design → record → grid → sign out) and real unauthenticated-client error rows (#22)
- Auto-generated UI: metadata-driven grid, form, and detail views served by one route set (`/doctypes/...`) for every DocType — columns, controls, sorting, and typed filters all derived from the stored definition (#8)
- DocType designer: create a DocType entirely in the UI (fields with type/required/filterable/options); server validation surfaced inline (#8)
- Record grid on TanStack Table v8 (headless; chosen over the unmaintained Glide Data Grid and DOM-virtualized AG Grid after live-registry re-research): server-side filter/sort via the capability-2 repository query paths, previous rows kept on screen while refetching (#8)
- Metadata-driven record forms (create + edit) that omit unset fields, preserving the engine's unset ⇒ no-sidecar-row semantics; detail view with system fields and delete (#8)
- 39-row capability-3 test matrix including the zero-code tracer bullet (design → create → grid → edit → delete, through the UI alone) and a 200-row rendered-grid guard (#8)
- DocType engine: portable JSON definitions (canonical serialization, validated on intake) in a `doctypes` metadata table with `source: package | site` (#6)
- Per-DocType record tables (`dt_<name>`, Frappe-style system fields) plus the fixed `fieldIndex` sidecar serving indexed filter/sort on user-defined fields (#6)
- Repository layer — the single record-access seam: CRUD with declarative validation, lifecycle-hook invocation for package DocTypes, sidecar maintenance, native-vs-sidecar query-path selection (#6)
- Package-mode codegen (`npm run gen:doctypes`): `doctypes/*.json` + materialization registry → generated schema entries, TS types, and hook stubs; drift-checked in CI (#6)
- Materialization ladder: `promote`/`demote` (source flip, zero data movement, round-trip property-tested) and `materialize`/`rebuildSidecar` (sidecar cleanup/rebuild); staged-index materializations stay on the sidecar path until enabled (ADR 0004 amendment) (#6)
- 54-row capability-2 test matrix including a 1,000-record filter/sort tracer bullet and fast-check properties (#6)
- July 2026 decision revalidation report — all five ADRs reaffirmed against live primary sources; ADR 0004 amended with staged indexes; capability-workflow right-sizing rules; capability-3 grid re-research flagged (#4)
- npm-workspaces monorepo (ESM-only, strict TypeScript) with `apps/web`: React 19 + Vite + TanStack Router (file-based routes) + TanStack Query via the `@convex-dev/react-query` bridge (#2)
- Convex backend: `users`/`tasks` schema, `tasks.list`/`tasks.add` functions, committed `_generated` code with a CI drift check (#2)
- feather-testing-convex harness on Vitest 4 projects — edge-runtime for `convex/**`, jsdom for `src/**` — with a 12-test matrix including the seeded-integration tracer bullet (#2)
- 100% line-coverage floor (v8 provider), ESLint 10 flat config with lint-enforced snapshot/`toBeDefined` bans, Prettier (#2)
- GitHub Actions CI gating on codegen drift, lint, format, typecheck, coverage-gated tests, and build (#2)
