# Featherbase — Agent Instructions

Metadata-driven app platform on Convex + React. Design decisions live in
[docs/VISION.md](docs/VISION.md), [docs/ROADMAP.md](docs/ROADMAP.md), and
[docs/adr/](docs/adr/) — do not re-litigate them.

## Workflow (issue-driven docs)

```
Issue #N → docs/capabilities/N-name/ → 1_research.md → 2_spec.md → 3_plan.md → execute → PR
```

1. **Check for existing docs**: `ls docs/capabilities/` — look for a folder matching your task.
2. **If docs exist, follow the plan** — read `1_research.md`, `2_spec.md`, `3_plan.md` in
   order and execute the plan's steps, verifying each gate. Don't deviate without updating
   the docs first.
3. **If docs don't exist, create them first** — research → spec (with test matrix) → plan →
   get approval → execute.
4. If a design contradicts an ADR, supersede the ADR explicitly (new ADR, link both ways).

## Commands

```bash
npm install            # workspace install (root)
npm test               # vitest run (apps/web, both projects)
npm run test:coverage  # with 100%-line threshold enforced
npm run typecheck      # tsc --noEmit
npm run lint           # eslint (flat config, root)
npm run format:check   # prettier
npm run build          # vite build
npx convex codegen     # regenerate convex/_generated (run in apps/web; committed)
```

## Testing conventions (binding — see docs/research/feather-testing-study.md)

- **Test matrix before code**: the spec defines states; one test per state; row count == test count.
- **MECE states, integration-first**: real in-memory backend (feather-testing-convex fixtures
  `client`, `seed`, `createUser`); mocks only for states unreachable with a real backend
  (loading spinners, forced errors).
- **Naming**: verb-first, no "should", under 8 words — `"shows empty state when no tasks"`.
- **Banned** (lint-enforced): snapshots, `toBeDefined()`-style assertions.
- **Coverage**: 100% lines is the floor. Never add `v8 ignore` comments — humans only.
- Vitest 4 `test.projects` split: `convex/**` tests run in edge-runtime, `src/**` in jsdom.
  Do not use `environmentMatchGlobs` (removed in Vitest 4).

## Commits

Reference the capability issue: `feat(scaffold): ... \n\nRefs #2.`
Update CHANGELOG.md ([Keep a Changelog](https://keepachangelog.com/)) under `[Unreleased]`.

## Layout

```
apps/web/          # React + Vite + TanStack Router app
  convex/          # schema, functions, test.setup.ts, _generated (committed)
  src/             # components, routes (file-based), tests colocated
packages/          # future @featherbase/* packages (capability 2+)
docs/capabilities/ # per-capability research → spec → plan
```
