# Capability 1 — Scaffold: Plan

> Issue: [#2](https://github.com/siraj-samsudeen/featherbase/issues/2) · Depends on: [2_spec.md](2_spec.md)
> Each step ends at a **gate** — a command whose success is the condition for moving on. If a gate fails, fix within the step; if the fix contradicts the spec, update the spec first.
> Commits: one per step (or tighter), message referencing #2, e.g. `feat(scaffold): …\n\nRefs #2`.

## Version pins (from research; adjust only if install fails, and record why here)

react/react-dom `^19.2`, vite `^8.1`, @vitejs/plugin-react `^6.0`, @tanstack/react-router + router-plugin `^1.170/^1.168`, @tanstack/react-query `^5`, @convex-dev/react-query `^0.1`, convex `^1.42`, convex-test `^0.0.54`, feather-testing-convex `^0.5.7`, vitest + @vitest/coverage-v8 `^4.1`, jsdom `^29`, @edge-runtime/vm `^5`, typescript `~5.9.3`, eslint `^10`, typescript-eslint `^8.63`, @vitest/eslint-plugin `^1.6`, eslint-plugin-react-hooks `^7`, prettier `^3.9`. Node 24.

## Step 1 — Monorepo root

Files: root `package.json` (`"type": "module"`, `"private": true`, `workspaces: ["apps/*", "packages/*"]`, engines `node >=24`, delegating scripts `dev/test/lint/format/typecheck/build`), `tsconfig.base.json` (strict, ES2022, bundler resolution, `noUncheckedIndexedAccess`), `.gitignore` (node_modules, dist, coverage, .env*), `.prettierrc`, `.prettierignore` (generated files, package-lock), `CHANGELOG.md` (keep-a-changelog skeleton, `[Unreleased]`), `CLAUDE.md` (docs-workflow wiring: check `docs/capabilities/`, follow plan if present, create docs first if not; test conventions summary; commands).

**G1:** `npm install` exits 0 and produces a lockfile; `node --input-type=module -e "import('node:process')"` sanity; `git status` shows only intended files.

## Step 2 — apps/web: Vite + React + TanStack Router

Files: `apps/web/package.json`, `index.html`, `vite.config.ts` (`tanstackRouter()` before `react()`), `tsconfig.json` (extends base; jsx react-jsx), `src/main.tsx`, `src/routes/__root.tsx`, `src/routes/index.tsx` (renders heading "Featherbase" + `<TaskList />` placeholder), `src/components/TaskList.tsx` (static markup for now), generated + committed `src/routeTree.gen.ts`.

**G2:** `npm run build -w apps/web` exits 0; `npm run dev -w apps/web &` then `curl -sf localhost:5173` returns the index html (kill after).

## Step 3 — Convex wiring

Files: `apps/web/convex/schema.ts` (`users: defineTable({})`; `tasks: defineTable({ userId: v.id("users"), text: v.string(), completed: v.boolean() }).index("by_userId", ["userId"])`), `convex/tasks.ts` (`list`/`add` per spec behavior, `ctx.auth.getUserIdentity()` for the caller), run `npx convex codegen` and commit `_generated/`. Wire `main.tsx`: `ConvexQueryClient` bridge (`@convex-dev/react-query`) + `QueryClientProvider` + `ConvexProvider` + `RouterProvider`; `VITE_CONVEX_URL` read with a dev-friendly fallback so build works without a deployment. Make `TaskList` real: `useQuery(convexQuery(api.tasks.list, {}))` + add-form calling `useMutation(api.tasks.add)`, four visual states per spec.

**G3:** `npx convex codegen` is clean on re-run (`git diff --exit-code`); `tsc --noEmit` and `vite build` exit 0.

## Step 4 — Test harness

Deps: feather-testing-convex, convex-test, @testing-library/react + user-event + jest-dom, jsdom, @edge-runtime/vm, vitest, @vitest/coverage-v8. Files: `apps/web/vitest.config.ts` — **Vitest 4 `test.projects`** (not `environmentMatchGlobs`, removed in v4): project `convex` = edge-runtime env, include `convex/**/*.test.ts`; project `web` = jsdom env, include `src/**/*.test.{ts,tsx}`, `@vitejs/plugin-react`; both with `server.deps.inline: ["convex-test"]`, `globals: true`, setupFiles. `convex/test.setup.ts` (per library README: `import.meta.glob` modules, `createConvexTest(schema, modules)`, re-export `renderWithConvexQuery`/`renderWithConvexQueryAuth` from `feather-testing-convex/tanstack-query`), `src/test-setup.ts` (jest-dom).

**G4:** one throwaway smoke test per project (backend: `client` fixture resolves; component: `render(<div/>)`) — `npx vitest run` green in both environments; delete the throwaways in the same step.

## Step 5 — Test matrix implementation

`convex/tasks.test.ts`: rows B1–B6. `src/components/TaskList.test.tsx`: rows I1–I4 (I1 mocks only the query hook layer — never seedable data; I3 is the tracer bullet, `seed` → `renderWithConvexQueryAuth` → `findByText`; I4 uses user-event + auto-invalidation, no remount). `src/routes/index.test.tsx`: row R1 (`createRouter` + memory history over the committed `routeTree.gen.ts`, render `RouterProvider` inside the harness wrapper).

**G5:** `npx vitest run` — all green; test count == 11 == matrix row count; names verb-first, no "should".

## Step 6 — Coverage floor

`vitest.config.ts` coverage block: provider v8, `thresholds: { lines: 100 }`, exclude exactly the spec's exclusion table.

**G6:** `npx vitest run --coverage` passes thresholds. Negative check: temporarily add an unreached branch to `TaskList`, confirm the run **fails**, remove it.

## Step 7 — Lint + format

Root `eslint.config.js`: typescript-eslint `recommendedTypeChecked` (project service), react-hooks, @vitest/eslint-plugin on test files with `vitest/no-restricted-matchers` banning `toMatchSnapshot`, `toMatchInlineSnapshot`, `toThrowErrorMatchingSnapshot`, `toBeDefined`; ignores for generated files. Prettier config finalized; `npm run lint` / `npm run format:check` root scripts.

**G7:** `eslint .` and `prettier --check .` exit 0. Negative check: add `expect(x).toBeDefined()` to a test file, confirm eslint **fails**, remove it.

## Step 8 — CI

`.github/workflows/ci.yml`: on `pull_request` + `push: branches: [main]`; Node 24 + npm cache; steps in order, each fatal: `npm ci` → `npx convex codegen && git diff --exit-code` (drift) → lint → format check → typecheck (`tsc --noEmit` per workspace) → `vitest run --coverage` → `vite build`.

**G8:** push the branch; the workflow run on GitHub is green **and its test-step log shows the 11 tests executed** (guards against a silently-skipped test step — the reference repo's exact gap). Failure-detection check: push one commit with a broken assertion, confirm the run goes red, revert (or verify locally via `vitest run; echo $?` ≠ 0 if we choose not to burn a CI run — prefer the real CI check, it's the point of this capability).

## Step 9 — Docs, changelog, issue close-out

Update `CHANGELOG.md` (`[Unreleased]` → scaffold entries), update root `README.md` status line (design phase → scaffold landed), tick issue #2 checkboxes, comment on #2 linking the green CI run.

**G9 (capability done):** PR opened referencing #2 → CI green on the PR → after merge, CI green on `main` (the tracer bullet passing on main is the ROADMAP's definition of done) → close #2. Merging is the maintainer's call — the plan ends with the PR + green CI + close-out comment ready.

## Deviations discovered during implementation (all recorded per the plan's own rule)

1. **`engines`: `>=22.12` not `>=24`** — the dev container runs Node 22; 22.12 is Vite 8's floor. CI still runs Node 24.
2. **`npx convex codegen` now requires a deployment** (it pulls deployment config). The hidden `--system-udfs` flag takes the classic local-only `doCodegen` path and emits the fully typed api. Command everywhere (dev + CI drift check): `npx convex codegen --system-udfs --typecheck disable`.
3. **The README's module glob matches nothing under Vite 8** — tinyglobby (Vite 6+) dropped extglob support, so `./**/!(*.*.*)*.*s` silently returns `{}`. Replaced with explicit include/exclude patterns in `convex/test.setup.ts`.
4. **`@convex-dev/auth` is required after all** — feather-testing-convex's root export unconditionally imports `ConvexTestAuthProvider`, which imports an internal `@convex-dev/auth` path. Installed as a devDep, `convexTestProviderPlugin()` added to both vitest projects, and the library itself added to `server.deps.inline` so the plugin can intercept the import. (Research decision 3's "avoids the vitest-plugin workaround" was wrong; auth _usage_ remains deferred. Worth an upstream issue: optional peer leaking through the root export.)
5. **`@vitejs/plugin-react` dropped from the vitest config** — Vite transforms TSX natively; the plugin is only needed for fast-refresh in the dev server (it stays in `vite.config.ts`).
6. **Matrix grew to 12 rows** — the coverage floor exposed that the spec'd unauthenticated-list behavior had no row; added as B7 (spec updated first).
7. **Coverage text reporter hides fully-covered files in Vitest 4** — the summary totals and thresholds are authoritative; don't be alarmed by a near-empty table.

## Rollback / risk notes

- **Version drift** (research pins go stale): G1/G4 catch it at install/run time; record any substitution in this file's pin table.
- **`environmentMatchGlobs` copy-paste risk**: forbidden — Vitest 4 rejects it; projects config is the only path (research §"README/reality gap").
- **routeTree.gen.ts / \_generated drift**: both committed, both regenerated + diff-checked in CI (G3, G8).
- **jsdom vs edge-runtime flakiness**: if a backend test misbehaves under edge-runtime, the fallback proven by the reference repo is running it under jsdom — record as a spec deviation if taken.
