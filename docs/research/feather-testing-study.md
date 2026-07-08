# feather-testing-convex Library Study

> **Provenance:** research agent report, 2026-07-08, from a study of the local repo at `NonDropBoxProjects/feather-testing-convex`. Preserved verbatim. This library and its TESTING-PHILOSOPHY.md are first-class assets for Featherbase — the testing story transfers 1:1 to the chosen Convex stack (ADR 0001), and the "Siraj's conventions" section is the style guide for this repo.

---

# Report: `feather-testing-convex` — What It Is and How Portable It Is

Repo: `/Users/siraj/Desktop/NonDropBoxProjects/feather-testing-convex` (git repo, npm-published package `feather-testing-convex` v0.5.6, MIT)

## 1. Purpose & Design

**Problem it solves:** there is no fast, in-process way to test a React component against a real Convex backend. Backend-only tests (`convex-test`) miss the component; mocked-hook component tests drift from reality; Playwright E2E is slow and gives no code coverage. The library "wires convex-test's in-memory backend into React's provider tree": `useQuery` in a component → hits a real Convex function → real data → renders — all inside Vitest, no server, full coverage.

**Philosophy** (`TESTING-PHILOSOPHY.md`, 25KB — the canonical doc, explicitly written for **human-defines / AI-agent-fills** test workflows):

- **MECE decomposition**: decompose a component into _visual states_; exactly one test per state, many assertions per test. "Test explosion" (one assertion per test) is called out as the #1 AI-agent mistake.
- **Three layers**:
  - **E2E (Playwright)** — ~10 smoke tests for critical journeys only; a _deliberate exception to MECE_ (intentionally overlaps integration for real-browser confidence).
  - **Integration (this library)** — the workhorse; real in-memory backend + real React; happy paths + core failure paths; bulk of coverage.
  - **Unit/Mock** — only for states unreachable with a real backend (loading spinners, error states).
- Integration-first as anti-pattern-killer: delete the backend-only test AND the mocked component test; one integration test covers both.
- **Test Matrix workflow**: human writes a state/approach/verify table before any code; agent fills it row-by-row; review checks row-count == test-count.
- Naming convention (`"shows empty state when no todos"`, verb-first, no "should", <8 words), ban on snapshots and `toBeDefined()`-style assertions, **100% line coverage as protection for multi-agent development** ("`v8 ignore` — humans only; agents must never add it").
- A 12/13-point review checklist, operationalized as a shipped Claude Code skill (`skills/review-convex-tests/SKILL.md` with 4 reference files).
- `docs/research-synthesis.md` shows the philosophy was stress-tested by 5 independent LLM research agents.

## 2. Architecture & API Surface

~640 LOC of non-test source across 8 files, plus a separate backend-agnostic sibling package `feather-testing-core` (~376 LOC — "Phoenix Test-inspired fluent DSL").

| Module                           | LOC  | What it does                                                                                                                                                                                                                                                                                     |
| -------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/ConvexTestProvider.tsx`     | 107  | **The crux.** Fake client adapting convex-test's one-shot `query/mutation` to the reactive `watchQuery` API `ConvexProvider` expects. Two-level cache (query-ref → args → result) to avoid collisions; careful stable-reference work to avoid `setAuth`/`clearAuth` render cycles.               |
| `src/helpers.tsx`                | 89   | `createConvexTest(schema, modules)` → Vitest `test.extend` with fixtures: `testClient`, `userId` (auto-created user), `client` (authenticated via `withIdentity`), `seed(table, data)` (auto-fills `userId`), `createUser()`. Plus `renderWithConvex`, `renderWithConvexAuth`, `wrapWithConvex`. |
| `src/ConvexTestAuthProvider.tsx` | 51   | Injects `ConvexAuthActionsContext` (imported from an _internal_ `@convex-dev/auth` path) so `useAuthActions`, `<Authenticated>`, `useConvexAuth()` work. `signIn/signOut` are pure React state toggles; `signInError` option simulates failed sign-in.                                           |
| `src/tanstack-query.tsx`         | 295  | For `useQuery(convexQuery(...))` apps: custom `queryFn` routing `["convexQuery", name, args]` keys to the test backend via `makeFunctionReference`; **auto-invalidates queries after mutations** → reactive UI in tests (fixes the base provider's one-shot limitation).                         |
| `src/vitest-plugin.ts`           | 52   | Vite alias plugin working around `@convex-dev/auth` not exporting its context (upstream issue filed).                                                                                                                                                                                            |
| `src/rtl/index.ts`               | 12   | `renderWithSession` = `renderWithConvexAuth` + `createSession()` from core.                                                                                                                                                                                                                      |
| `src/playwright/index.ts`        | 23   | Extends the core Playwright `test` with an auto-cleanup fixture that calls a user-supplied `clearAll` Convex mutation after each test.                                                                                                                                                           |
| `feather-testing-core` (dep)     | ~376 | Fluent `Session` DSL: thenable action-queue (`fillIn`, `clickButton`, `assertText`, `within`, `submit`, ...) with two drivers — RTL and Playwright — and chain-trace error messages (`[ok]/[FAILED]/[skipped]` per step).                                                                        |

**Representative tests, verbatim.** Integration test (README quick start — the signature 3-liner):

```tsx
test("shows seeded data", async ({ client, seed }) => {
  await seed("todos", { text: "Buy milk", completed: false });
  renderWithConvex(<TodoList />, client);
  expect(await screen.findByText("Buy milk")).toBeInTheDocument();
});
```

Multi-user isolation from the library's own suite (`src/helpers.test.ts`):

```tsx
test("multi-user data isolation", async ({ client, seed, createUser }) => {
  const bob = await createUser();
  await seed("todos", {
    text: "Bob's todo",
    completed: false,
    userId: bob.userId,
  });

  const myTodos = await client.query(api.todos.list, {});
  expect(myTodos).toHaveLength(0);

  const bobTodos = await bob.query(api.todos.list, {});
  expect(bobTodos).toHaveLength(1);
  expect(bobTodos[0].text).toBe("Bob's todo");
});
```

Session DSL / E2E style:

```tsx
await session
  .visit("/signup")
  .fillIn("Email", "alice@example.com")
  .clickButton("Sign Up")
  .assertText("Welcome, alice!");
```

## 3. How It Achieves Automation

- **Backend:** the official **`convex-test` in-memory mock** — not a real local Convex backend. Convex functions run in Vitest's `edge-runtime` environment; components in jsdom.
- **Auth simulation:** `testClient.withIdentity({ subject: userId })` for backend identity; a `setAuth` shim + `useAuth` hook for `<Authenticated>` UI state; `signIn/signOut` as React state toggles (no backend call); `signInError` for failure paths.
- **Seeding:** `seed()` fixture (direct `ctx.db.insert` with auto `userId`); every test gets a fresh `convexTest()` instance → fully isolated.
- **Playwright layer is the exception:** it targets a **real running Convex deployment** (`convexUrl`) and cleans up via a user-provided `clearAll` mutation via `ConvexHttpClient` — shared-state, not hermetic.
- **Determinism:** integration layer is highly deterministic — in-memory, no network, no retries (`retry: false`, `gcTime: Infinity` in the test QueryClient). The whole suite (27 tests) runs in **~1.0s** (verified: all pass). **No time/scheduler control** — nothing touches `vi.useFakeTimers` or convex-test's scheduler advancement; cron/scheduled-function testing is out of scope.
- **Known limitation (documented):** base `ConvexTestProvider` queries are one-shot — after a mutation the UI doesn't update; you re-query the backend, re-mount, or use the TanStack provider (which auto-invalidates). Also documents an upstream convex-test bug (nested `runQuery` loses auth) with workarounds.

## 4. Tech Stack

- **Frontend assumed:** React (18 or 19 peer), rendered with React Testing Library + `user-event` in jsdom. TanStack Query optional path. No framework assumption beyond React (no Next/Vite app coupling; `@vitejs/plugin-react` only for the test transform).
- **Runners:** Vitest 4 (integration/unit) + Playwright ≥1.40 (E2E, optional peer).
- **TypeScript:** strict, ESM-only (`"type": "module"`), `moduleResolution: bundler`, `tsc` build to `dist/` with declaration maps, subpath exports (`.`, `/vitest-plugin`, `/rtl`, `/playwright`, `/tanstack-query`), optional peers via `peerDependenciesMeta`. Pragmatic `any` at library boundaries (fixture types) rather than heavy generics.
- **Package manager:** npm (`package-lock.json`). **No ESLint/Prettier/Biome config in the repo** (the philosophy doc's "ESLint enforces the snapshot ban" is aspirational).
- CI: GitHub Actions auto-publish to npm on push to main with provenance + auto patch-bump. Notably it does **not run tests** before publishing.

## 5. Convex Coupling — The Honest Portability Estimate

**Inherently Convex-specific (would not transfer):** essentially all of `src/` — the `watchQuery` adapter, the `@convex-dev/auth` context injection + vitest plugin, the TanStack `queryFn` (`convexQuery` keys, `makeFunctionReference`), and the fixture implementations (`convexTest`, `withIdentity`, `ctx.db.insert`). That's ~530 LOC of logic + ~670 LOC of tests.

**Portable as-is (no rebuild):**

- **`feather-testing-core`** — the Session DSL, both drivers, error-trace machinery. Zero Convex imports. Works today with any React app and any Playwright target.
- **`TESTING-PHILOSOPHY.md`** — MECE, three layers, test matrix, naming convention, coverage rules, review checklist structure. ~90% stack-agnostic; only examples and 4–5 checklist items (seed/one-shot/withIdentity specifics) need rewriting.
- **The `review-convex-tests` skill architecture** (checklist skill + reference files, dual file/plan mode).
- **The design patterns**: `test.extend` fixtures (`client`/`seed`/`createUser`), "render with real backend provider", Playwright fixture with auto-cleanup mutation. The _shapes_ transfer 1:1.

**What a Supabase/InstantDB stack would need rebuilt:** the middle adapter — an in-process (or fast local) backend wired into the frontend data layer. For Supabase that's a different problem (real local Postgres via `supabase start`/pglite + Supabase JS client pointing at it, JWT-claim auth simulation, `seed()` over SQL/PostgREST) — less "clever adapter", more infrastructure, and reactivity (Realtime) is harder to make hermetic. For InstantDB, **no `convex-test` equivalent exists** — you'd be building the in-memory backend itself, which is the piece this library gets for free from Convex. That's the biggest hidden dependency: the library is ~600 LOC because Convex ships an official in-memory mock; its equivalent elsewhere could be 10x the effort.

**Bottom line:** roughly **40–50% of the value ports directly** (philosophy + DSL + fixture/API design + review skill), and the code to rebuild is small — but the rebuild cost is dominated by whether the alternative backend has a convex-test-grade local mock. Convex is unusually strong here; that asymmetry is itself a stack-decision input.

## 6. Maturity

- **Git:** 45 commits, 2026-02-05 → 2026-05-09 (last activity ~2 months ago; local branch 1 commit behind origin). Clean tree.
- **Self-tests:** 27 tests / 4 files, **all passing in ~1s** (verified). Coverage of the library's own surface is decent (provider, auth provider, fixtures, tanstack) though the philosophy's 100%-coverage bar isn't enforced in this repo's CI (publish workflow skips tests).
- **TODOs:** exactly one (`src/ConvexTestAuthProvider.tsx:1` — waiting on an upstream `@convex-dev/auth` public export; upstream issue filed).
- **Size:** 62 tracked files; ~1,370 LOC in `src/` + sample `convex/` combined; README 33KB; per-feature docs folders.
- **Feel:** small but polished and genuinely shipped — npm-published with provenance, keep-a-changelog, documented limitations with upstream issue links, GitHub issues referenced in fixes (#2, #6, #8, #10, #14). Gaps: no lint config, no test step in CI, `any`-typed fixtures.

## Siraj's Conventions Worth Matching in Frappe++

1. **Issue-driven docs workflow**: `docs/N-feature-name/1_research.md → 2_spec.md → 3_plan.md → execute → PR`, wired into `CLAUDE.md` ("if docs exist, follow the plan; if not, create them first").
2. **Ships agent skills with the package**: `skills/review-convex-tests/` + `references/`, an installer bin (`feather-install-skills`), TanStack Intent auto-discovery, and a `.claude-plugin/marketplace.json`.
3. **`feather-*` ecosystem naming** with a core/adapter split (`feather-testing-core` backend-agnostic, `feather-testing-convex` adapter) — the exact split that would make a `feather-testing-supabase` feasible.
4. **Package hygiene**: ESM-only, subpath exports, optional peers with `peerDependenciesMeta`, strict TS, `tsc`-built `dist/` (gitignored), Keep-a-Changelog + semver, npm auto-publish CI with auto patch-bump.
5. **Testing culture**: human-authored test matrix, verb-first test names, integration-first, snapshot ban, "coverage is the floor, review is the ceiling", explicit human-only escape hatches (`v8 ignore`).
6. **Docs style**: README leads with a comparison table + problem statement, then before/after code pairs for every feature.

Key files: `/Users/siraj/Desktop/NonDropBoxProjects/feather-testing-convex/README.md`, `TESTING-PHILOSOPHY.md`, `src/ConvexTestProvider.tsx`, `src/helpers.tsx`, `src/tanstack-query.tsx`, `src/playwright/index.ts`, `skills/review-convex-tests/SKILL.md`, `docs/research-synthesis.md`, `CLAUDE.md`.

---

## Gaps to close when adopting for Featherbase (noted 2026-07-08)

1. **No time/scheduler control yet** — Featherbase's flows engine (capability 6) needs `vi.useFakeTimers()` + convex-test scheduler advancement to test sleeps/retries; this is an extension to build in the library, not just the app.
2. **CI publishes without running tests** — Featherbase CI must run tests as a gate (ROADMAP capability 1).
3. **No lint config** — decide and enforce one in the scaffold.
