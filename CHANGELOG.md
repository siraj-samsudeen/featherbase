# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- DocType engine: portable JSON definitions (canonical serialization, validated on intake) in a `doctypes` metadata table with `source: package | site` (#6)
- Per-DocType record tables (`dt_<name>`, Frappe-style system fields) plus the fixed `fieldIndex` sidecar serving indexed filter/sort on user-defined fields (#6)
- Repository layer — the single record-access seam: CRUD with declarative validation, lifecycle-hook invocation for package DocTypes, sidecar maintenance, native-vs-sidecar query-path selection (#6)
- Package-mode codegen (`npm run gen:doctypes`): `doctypes/*.json` + materialization registry → generated schema entries, TS types, and hook stubs; drift-checked in CI (#6)
- Materialization ladder: `promote`/`demote` (source flip, zero data movement, round-trip property-tested) and `materialize`/`rebuildSidecar` (sidecar cleanup/rebuild) (#6)
- 53-row capability-2 test matrix including a 1,000-record filter/sort tracer bullet and fast-check properties (#6)

- npm-workspaces monorepo (ESM-only, strict TypeScript) with `apps/web`: React 19 + Vite + TanStack Router (file-based routes) + TanStack Query via the `@convex-dev/react-query` bridge (#2)
- Convex backend: `users`/`tasks` schema, `tasks.list`/`tasks.add` functions, committed `_generated` code with a CI drift check (#2)
- feather-testing-convex harness on Vitest 4 projects — edge-runtime for `convex/**`, jsdom for `src/**` — with a 12-test matrix including the seeded-integration tracer bullet (#2)
- 100% line-coverage floor (v8 provider), ESLint 10 flat config with lint-enforced snapshot/`toBeDefined` bans, Prettier (#2)
- GitHub Actions CI gating on codegen drift, lint, format, typecheck, coverage-gated tests, and build (#2)
