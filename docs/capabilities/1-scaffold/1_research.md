# Capability 1 — Scaffold: Research

> Issue: [#2](https://github.com/siraj-samsudeen/featherbase/issues/2) · Date: 2026-07-08
> Inputs: [ROADMAP](../../ROADMAP.md) capability 1, [ADR 0001](../../adr/0001-stack-convex-react-vite.md), [feather-testing-study](../../research/feather-testing-study.md) ("Siraj's Conventions" + gaps-to-close addendum).

## What we're building

The tracer bullet for the whole platform: a monorepo where a React component, rendered against a **real in-memory Convex backend** with seeded data, passes an integration test **in CI**. Everything else in this capability exists to make that one test honest — real router, real Convex functions, real coverage gate, CI that actually fails when tests fail.

## What exists (verified against npm/GitHub, 2026-07-08)

### feather-testing-convex 0.5.7 (the harness we wire in)

Facts confirmed from the published package + repo source:

- **Exports**: `.` (createConvexTest, renderWithConvex, renderWithConvexAuth, providers), `/tanstack-query` (renderWithConvexQuery[Auth], auto-invalidation), `/vitest-plugin` (auth-only workaround), `/rtl` (Session DSL), `/playwright`.
- **Fixtures** from `createConvexTest(schema, modules)`: `testClient`, `userId`, `client` (authenticated via `withIdentity`), `seed(table, data)` (auto-fills `userId`), `createUser()`.
- **Hard requirement**: the fixture auto-creates a row in a `users` table (name configurable via `usersTable` option) — **our schema must define `users`** even before we have auth.
- **Required peers** for the base path: `convex`, `convex-test`, `react`, `vitest`, `@testing-library/react`, `@testing-library/user-event` (+ `jsdom`, `@vitejs/plugin-react` as setup deps). `@convex-dev/auth`, `@tanstack/react-query`, `@convex-dev/react-query`, `@playwright/test` are **optional** peers.
- **Setup surface** (from README quick start): `vitest.config.ts`, `convex/test.setup.ts` (exports `test` + `modules` via `import.meta.glob`), `src/test-setup.ts` (jest-dom matchers).
- **Known limitation**: base `ConvexTestProvider` queries are **one-shot** — after a mutation the UI doesn't re-render. The `/tanstack-query` provider fixes this by auto-invalidating queries after mutations (reactive UI in tests).
- Depends on `feather-testing-core` ^0.1.0 (Session DSL — backend-agnostic).

### A README/reality gap we must not copy

The npm README's quick start uses `environmentMatchGlobs` to run `convex/**` in edge-runtime. **Vitest 4 removed `environmentMatchGlobs`** (deprecated in v3). Notably, the library's own `vitest.config.ts` on main no longer uses it (runs everything in jsdom). The Vitest-4-native replacement is **`test.projects`** — one project per environment. We'll use two projects: `jsdom` for `src/**` component tests, `edge-runtime` for `convex/**` backend tests (edge-runtime matches Convex's actual function runtime, per convex-test's own docs). Both need `server.deps.inline: ["convex-test"]`.

### Version compatibility snapshot (registry, 2026-07-08)

| Package | Latest | Compat notes |
|---|---|---|
| convex | 1.42.1 | react ^18 \|\| ^19 peer ✓ |
| convex-test | 0.0.54 | |
| feather-testing-convex | 0.5.7 | vitest >=1 peer ✓ |
| react / react-dom | 19.2.7 | |
| vite | 8.1.3 | vitest 4 peers `vite ^6 || ^7 || ^8` ✓ |
| @vitejs/plugin-react | 6.0.3 | requires vite ^8 ✓ |
| vitest / @vitest/coverage-v8 | 4.1.10 | |
| @tanstack/react-router | 1.170.17 | react >=18 ✓ |
| @tanstack/router-plugin | 1.168.19 | vite >=8 supported ✓ |
| typescript | 6.0.3 latest | **pin ~5.9.3** — matches reference repo; typescript-eslint supports <6.1.0 but TS 6 is weeks old, no upside for a scaffold |
| eslint | 10.6.0 | typescript-eslint 8.63.0 supports eslint ^10 ✓ |
| @vitest/eslint-plugin | 1.6.21 | |
| @edge-runtime/vm | 5.0.0 | needed for the edge-runtime test project |
| Node | 24 LTS | CI runtime |

## Decisions (options considered)

### 1. Monorepo: npm workspaces, no task runner
Conventions mandate npm (`package-lock.json`). Layout: `apps/web` now; `packages/*` reserved for `@featherbase/*` (capability 2+, per ADR 0005). Turborepo/Nx rejected — one app, no build graph to orchestrate; YAGNI. Root scripts delegate with `npm run <script> -w apps/web`.

### 2. Data layer: TanStack Query bridge from day one
Two candidate app data layers: bare `convex/react` `useQuery`, or `@tanstack/react-query` + `@convex-dev/react-query`. **Chosen: the TanStack Query bridge**, because (a) it's the natural pairing with TanStack Router, and (b) it unlocks the harness's best testing path — the `/tanstack-query` provider auto-invalidates after mutations, so "user adds a task and sees it appear" is testable without re-mounting (escapes the one-shot limitation from day one). Cost: two extra deps, both optional peers the harness already supports.

### 3. Auth: deferred
`@convex-dev/auth` is not wired in. The `client` fixture's identity works via `withIdentity` without any auth package, and skipping auth avoids the `vitest-plugin` workaround entirely. Auth arrives with permissions (capability 5). The schema still ships a `users` table (fixture requirement, and `tasks.userId` exercises `seed()`'s auto-fill).

### 4. Lint (closes gap #3 from the study): ESLint flat config + Prettier
- **ESLint 10** (flat config) + **typescript-eslint** (type-checked recommended) + **@vitest/eslint-plugin** + **eslint-plugin-react-hooks**.
- The deciding factor over Biome: the testing philosophy's "ESLint enforces the snapshot ban" line was aspirational in feather-testing-convex — we make it real with `vitest/no-restricted-matchers` banning `toMatchSnapshot`/`toMatchInlineSnapshot`/`toBeDefined`. Biome has no Vitest-aware rules.
- **Prettier** for formatting (checked in CI); ESLint stays logic-only.

### 5. `convex/_generated`: committed + drift-checked
`npx convex codegen` runs offline (no deployment needed). Convention in Convex projects is to commit `_generated/`; tests and typecheck need it present after a bare clone. CI re-runs `convex codegen` and fails on `git diff` — committed artifacts can't silently drift (same policy ADR 0004 sets for the future generated `schema.ts`).

### 6. Coverage: 100% lines as floor, exclusions are generated/entry code only
Per the testing philosophy ("coverage is the floor, review is the ceiling"). Excluded: `convex/_generated/**`, `src/routeTree.gen.ts` (TanStack Router codegen, committed), `src/main.tsx` (DOM bootstrap, unreachable in jsdom tests), config files, test setup files. No `v8 ignore` comments — humans only, and there are no humans writing code yet.

### 7. CI (closes gap #2): GitHub Actions, tests as a required gate
The reference repo's CI publishes without testing — the exact failure mode capability 1 exists to prevent. Our workflow runs on PRs + pushes to main: install → codegen drift check → lint → format check → typecheck → **tests with coverage thresholds** → build. Any step failing fails the run.

## What we deliberately leave out

Playwright E2E (philosophy says ~10 smoke tests for critical journeys — none exist yet), `@convex-dev/workflow` (capability 6), fake-timer/scheduler control (gap #1 — capability 6, needs library work upstream), npm publishing (nothing to publish from this repo yet), Convex Cloud deployment (tests run against the in-memory backend; no deployment credentials needed for the tracer bullet).
