# Capability 1 — Scaffold: Spec

> Issue: [#2](https://github.com/siraj-samsudeen/featherbase/issues/2) · Depends on: [1_research.md](1_research.md)
> **Done when:** the seeded integration test (matrix row I3) passes in CI on main.

## Deliverables

1. npm-workspaces monorepo root — ESM-only (`"type": "module"`), strict TypeScript, committed `package-lock.json`.
2. `apps/web`: React 19 + Vite + TanStack Router (file-based routes) + TanStack Query with the `@convex-dev/react-query` bridge.
3. `apps/web/convex/`: schema (`users`, `tasks`) + `tasks.list` query + `tasks.add` mutation; `_generated/` committed.
4. feather-testing-convex harness: Vitest 4 with two projects (jsdom for `src/**`, edge-runtime for `convex/**`), `convex/test.setup.ts` fixtures, `src/test-setup.ts` jest-dom.
5. Test suite implementing the matrix below — including the tracer bullet.
6. ESLint 10 flat config (typescript-eslint type-checked + vitest plugin with snapshot/`toBeDefined` ban + react-hooks) and Prettier, both enforced in CI.
7. Coverage: v8 provider, **100% line coverage threshold**, exclusions limited to generated/bootstrap files (list below).
8. GitHub Actions CI: codegen drift check → lint → format check → typecheck → test (coverage-gated) → build; runs on PRs and pushes to main.
9. `CHANGELOG.md` (keep-a-changelog, `[Unreleased]` section) + root `CLAUDE.md` wiring the docs workflow ("if docs exist, follow the plan; if not, create them first").

## Repository layout

```
featherbase/
├── package.json              # workspaces: ["apps/*", "packages/*"], type: module
├── package-lock.json
├── tsconfig.base.json        # strict, ES2022, bundler resolution — extended by workspaces
├── eslint.config.js
├── .prettierrc / .prettierignore
├── .gitignore
├── CHANGELOG.md
├── CLAUDE.md
├── .github/workflows/ci.yml
└── apps/web/
    ├── package.json
    ├── index.html
    ├── vite.config.ts        # react() + tanstackRouter() plugins
    ├── vitest.config.ts      # two projects + coverage config
    ├── tsconfig.json
    ├── convex/
    │   ├── schema.ts         # users, tasks (userId, text, completed) + by_userId index
    │   ├── tasks.ts          # list (query), add (mutation)
    │   ├── test.setup.ts     # createConvexTest fixtures + render helpers
    │   ├── tasks.test.ts     # backend matrix rows (edge-runtime)
    │   └── _generated/       # committed, drift-checked in CI
    └── src/
        ├── main.tsx          # bootstrap: router + ConvexProvider + QueryClientProvider (coverage-excluded)
        ├── routeTree.gen.ts  # committed router codegen
        ├── routes/__root.tsx
        ├── routes/index.tsx  # renders <TaskList />
        ├── components/TaskList.tsx
        ├── components/TaskList.test.tsx
        ├── routes/index.test.tsx
        └── test-setup.ts
```

## Behavior

**`tasks.list` (query):** returns the authenticated user's tasks only, via the `by_userId` index. Unauthenticated → returns `[]` (no throw — keeps the unauthed UI state renderable; real permission enforcement is capability 5).

**`tasks.add` (mutation):** inserts `{ text, completed: false, userId }` for the authenticated caller. Unauthenticated → throws. Empty/whitespace `text` → throws (gives the backend a real validation edge to test).

**`<TaskList />`:** four visual states —

1. Loading: query pending → "Loading…"
2. Empty: `[]` → "No tasks yet"
3. Data: renders one `<li>` per task with its text
4. After add: form (labeled input "Task" + button "Add") submits `tasks.add`; the new task appears without remount (TanStack Query auto-invalidation)

**Route `/`:** renders the app shell (heading "Featherbase") and `<TaskList />`.

## Conventions (binding)

- ESM-only everywhere; strict TS (`strict`, `isolatedModules`, `moduleResolution: "bundler"`); npm; TypeScript ~5.9.
- Test names: verb-first, no "should", < 8 words.
- One test per matrix row — row count == test count (review checks this).
- No snapshots, no `toBeDefined()`-style assertions (lint-enforced).
- Integration is the default; mocks only for states unreachable with a real backend (here: only the loading state).
- Keep-a-changelog + semver; commits reference #2.

## Test matrix

Authored before code, per the testing philosophy (human defines states, agent fills tests). One test per row.

| #   | State (bucket)                          | Layer / env            | Approach                                                        | Verify                                                                          |
| --- | --------------------------------------- | ---------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| B1  | list returns empty for a new user       | backend / edge-runtime | integration                                                     | `client.query(api.tasks.list)` → `[]`                                           |
| B2  | list returns the seeded task            | backend / edge-runtime | integration                                                     | `seed("tasks", …)` → query returns 1 row, text matches                          |
| B3  | list scopes tasks to their owner        | backend / edge-runtime | integration                                                     | `createUser()` bob + seed with explicit `bob.userId` → alice sees 0, bob sees 1 |
| B4  | add inserts a task for the caller       | backend / edge-runtime | integration                                                     | `client.mutation(api.tasks.add, {text})` → query returns it, `completed: false` |
| B5  | add rejects blank text                  | backend / edge-runtime | integration                                                     | mutation with `"  "` → rejects                                                  |
| B6  | add rejects unauthenticated caller      | backend / edge-runtime | integration                                                     | `testClient.mutation(…)` → rejects                                              |
| B7  | list returns empty when unauthenticated | backend / edge-runtime | integration                                                     | `testClient.query(api.tasks.list)` → `[]` (spec'd no-throw behavior)            |
| I1  | shows loading state                     | component / jsdom      | **mock** (transient state — query resolves too fast to observe) | never-resolving query → "Loading…" visible                                      |
| I2  | shows empty state when no tasks         | component / jsdom      | integration                                                     | render via harness → "No tasks yet"                                             |
| I3  | **shows seeded tasks** ← tracer bullet  | component / jsdom      | integration                                                     | `seed("tasks", {text: "Buy milk"})` → render → `findByText("Buy milk")`         |
| I4  | adds a task and shows it                | component / jsdom      | integration                                                     | type into "Task", click "Add" → new text appears (no remount)                   |
| R1  | index route renders the app             | component / jsdom      | integration                                                     | memory-history router at `/` → heading + TaskList visible                       |

(B = backend, I = component integration/mock, R = router. 12 rows total. Row count == test count is the review invariant. B7 was added during implementation when the coverage floor exposed that the matrix missed the spec'd unauthenticated-list behavior — the floor doing exactly its job.)

## Coverage exclusions (exhaustive)

| Path                                        | Why                                          |
| ------------------------------------------- | -------------------------------------------- |
| `convex/_generated/**`                      | Convex codegen                               |
| `src/routeTree.gen.ts`                      | TanStack Router codegen                      |
| `src/main.tsx`                              | DOM bootstrap — unreachable from jsdom tests |
| `src/test-setup.ts`, `convex/test.setup.ts` | harness wiring                               |
| `*.config.*`                                | config files                                 |

Everything else: 100% line coverage, enforced as a Vitest threshold (CI fails below it). No `v8 ignore` comments.

## CI requirements

- Trigger: `pull_request` + `push` to `main`.
- Node 24, `npm ci` with npm cache.
- Steps, each a hard gate: `convex codegen` + `git diff --exit-code` (drift) → `eslint .` → `prettier --check .` → `tsc --noEmit` (per workspace) → `vitest run --coverage` (thresholds enforce the floor) → `vite build`.
- A failing test **must** fail the workflow — verified once during implementation by pushing a deliberately broken assertion (then reverted) or running the equivalent locally with exit-code check (see plan, gate G8).

## Out of scope

Playwright E2E, auth (`@convex-dev/auth`), Convex deployment/hosting, npm publishing, fake timers/scheduler control, anything DocType-shaped (capability 2).
