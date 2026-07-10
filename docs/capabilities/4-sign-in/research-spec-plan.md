# Capability 4 — Sign-in: research · spec · plan

> Issue: [#22](https://github.com/siraj-samsudeen/featherbase/issues/22) · Single file per the
> right-sizing rule (small, mechanical capability — [README](../README.md)); the test matrix is
> the non-negotiable section.
> **Done when:** every matrix row passes (row count == test count) with the 100% line-coverage
> floor and all CI gates green, and — after the documented deployment provisioning step — a
> person signs in from a real browser on the deployed app and runs the zero-code loop with no
> identity injection.

## 1. Research

Verified 2026-07-09 against the live npm registry, the installed package source
(`node_modules/@convex-dev/auth`), and the Convex Auth docs (via the `convex-setup-auth` skill).

1. **Pin `@convex-dev/auth` at exactly `0.0.90`.** The registry is at 0.0.94, but the GitHub
   repo publishes **no release notes at all** (releases page is empty), so the delta is
   unauditable; 0.0.90 is the version issue #22 vetted and the version already in the tree that
   feather-testing-convex 0.5.7 validated its auth fixtures against. It moves from devDependency
   (capability 1, deviation #4 — a test-harness leak) to a **pinned runtime dependency**.
   Revisit the pin when authorization lands (capability 7). `@auth/core` is its peer
   (`^0.37.0`, 0.37.4 installed) — pinned exactly too; Convex Auth's own docs warn its minor
   versions break.
2. **The Anonymous provider ships in-box** (`@convex-dev/auth/providers/Anonymous`) and needs
   zero configuration: `convexAuth({ providers: [Anonymous] })`. No email/OAuth/password config,
   no Auth.js provider objects, no redirect flow — `signIn("anonymous")` is a plain Convex
   action round-trip, which is exactly issue #22's one-click "get started". Upgrade path to real
   providers later is additive (append to `providers`).
3. **Required file shape** (per setup guide + package source): `convex/auth.ts` **must** live at
   that exact path (the generated functions self-reference `api.auth.*`/`internal.auth.*`);
   `convex/http.ts` serves `/.well-known/openid-configuration` + JWKS (the deployment validates
   its own tokens against these routes); `convex/auth.config.ts` declares the deployment as its
   own token issuer (`domain: process.env.CONVEX_SITE_URL, applicationID: "convex"`);
   `authTables` replaces the bare `users: defineTable({})` (drop-in: its `users` table is
   all-optional fields, so existing empty user docs and `tasks.userId: v.id("users")` stay
   valid). No conflict with `convex/doctype/auth.ts` (different path).
4. **`npx @convex-dev/auth` is deployment provisioning, not codegen.** It sets
   `JWT_PRIVATE_KEY`/`JWKS`/`SITE_URL` env vars on the _configured deployment_ and requires
   interactive CLI credentials — neither exists in this environment. The code in this capability
   is complete without it; the backend cannot _issue_ tokens until it runs. → human step,
   § Deployment provisioning.
5. **Convex Auth changes the subject format**: the JWT `subject` is `${userId}|${sessionId}`.
   `requireUser` returning `identity.subject` verbatim would fragment record ownership per
   session. The library exports `getAuthUserId(ctx: { auth }): Promise<Id<"users"> | null>` with
   the exact ctx shape of the existing seam — `requireUser` wraps it and now returns a typed
   `Id<"users">`. Side effect: the tasks demo's `identity.subject as Id<"users">` cast (flagged
   in #19) is replaced by the same helper; the full DocType rebuild stays #19's.
6. **The whole matrix runs without mocking auth hooks.** feather-testing-convex's
   `renderWithConvexQueryAuth(ui, client, { authenticated, signInError })` provides real
   `<Authenticated>`/`<Unauthenticated>`/`useConvexAuth()`/`useAuthActions()` state (signIn/out
   are real state toggles); the required `convexTestProviderPlugin()` has been in both vitest
   projects since capability 1. The raw `testClient` fixture allows a custom
   `withIdentity({ subject: "id|session" })` to pin the subject parsing. The in-memory backend
   cannot _issue_ real JWTs, so actual token issuance is verified in the browser after
   provisioning (tracer's manual half).
7. **Query-error states (#13) become integration-testable, mostly.** An unauthenticated real
   client is the production failure this capability exists for — `doctypes.list`/`doctypes.get`
   rejections need no mocks. Two states stay mock-rows (rejecting query fns, same policy as the
   four loading mocks): records/record failing _after_ the definition resolved (only reachable
   through server states the UI can't produce, e.g. #12's stale sort). The existing
   `renderPending` fixture is reworked onto the auth-aware provider stack (a fake never-resolving
   client passed to `renderWithConvexQueryAuth`) — under the new shell gate the old bare
   `ConvexProvider` wrapper would render nothing.

**Options considered.** Password/OTP/OAuth first: rejected — #22 pins anonymous-first.
Clerk/Auth0/WorkOS: rejected — #22 and the dependency tree pin Convex Auth. Hand-rolled
subject parsing in `requireUser`: rejected in favor of the library's `getAuthUserId` (same
behavior, no hand-rolled internals). `doctypes.sync` internalMutation (#17 item 2): **left
out** — nothing in this capability needs it; it stays with #17.

## 2. Spec

### Deliverables

1. **Backend**: `convex/auth.ts` (convexAuth + Anonymous), `convex/http.ts` (auth routes),
   `convex/auth.config.ts` (issuer), `convex/schema.ts` (`...authTables`),
   `convex/doctype/auth.ts` (`requireUser` via `getAuthUserId`, returns `Id<"users">`),
   `convex/tasks.ts` (same helper, cast removed), regenerated `convex/_generated`.
2. **Frontend**: `src/main.tsx` swaps `ConvexProvider` → `ConvexAuthProvider`;
   `src/routes/__root.tsx` gates the shell — `<AuthLoading>` "Loading…", `<Unauthenticated>`
   sign-in state ("Get started" → `signIn("anonymous")`, rejection shown `role="alert"`),
   `<Authenticated>` nav + "Sign out" button (`signOut`) + `<Outlet>`.
3. **Query-error branches (#13)**: `DoctypeList`, `DoctypeGate`, `RecordGrid`, `RecordDetail`
   each render `role="alert"` with the error message instead of hanging on "Loading…" when
   their query errors; `RecordDetail`'s Delete catches rejection and shows it inline
   (`role="alert"`), staying on the detail view. Mutation-error styling conventions unchanged
   (#14 owns copy polish).
4. **Dependencies** (apps/web, runtime, pinned exact): `@convex-dev/auth 0.0.90`,
   `@auth/core 0.37.4`.
5. **Fixtures** (`src/test.fixtures.tsx`): `renderApp` gains an options pass-through
   (`authenticated`, `signInError`); `renderPending` reworked onto the auth-aware stack;
   new `renderFailing` (rejecting query fns, optional resolved map); auth-loading render helper
   (real `ConvexProviderWithAuth` with an `isLoading: true` useAuth — the one state the fixture
   can't produce).
6. CHANGELOG entry; README status line; issue #22 comment at close-out.

### Behavior

**Unauthenticated visitors see the sign-in state, never a hang** (#22): heading + "Get started"
button only — no nav, no data queries mounted. Clicking it calls `signIn("anonymous")`; on
success Convex Auth stores the session and `<Authenticated>` swaps in; on rejection the message
shows inline and the button stays. **Authenticated users** see the capability-3 shell exactly as
before plus a "Sign out" button; signing out returns to the sign-in state (Convex Auth clears
the session; anonymous users get a fresh identity on next sign-in — accepted anonymous-first
semantics). **While auth state resolves** (page load, token refresh) the shell shows "Loading…".
**Query errors** render the error message in place of the affected view; recovery is
reactive (Convex requeries on auth/data change) or navigation.

### Test matrix

One test per row, verb-first names. Env: jsdom (`web` project) via
`renderWithConvexQueryAuth` + real routeTree, except B/C rows (edge-runtime `convex` project).
**Mock rows: A3, A5, E3, E4** — forced sign-in rejection, auth-pending, and post-definition
query rejections are unreachable with the real in-memory backend; every other row is
integration. E1/E2 use a **real unauthenticated client** — the actual production failure mode.

#### A — auth shell (`src/routes/__root.tsx`)

| #   | State                                    | Verify                                                                         |
| --- | ---------------------------------------- | ------------------------------------------------------------------------------ |
| A1  | shows sign-in state when unauthenticated | `/` with `authenticated: false` → "Get started"; no nav links                  |
| A2  | signs in when get-started is clicked     | click "Get started" → nav + tasks view render                                  |
| A3  | shows error when sign-in fails           | **mock** (`signInError`) → `role="alert"` with the message, button still there |
| A4  | signs out back to the sign-in state      | authenticated shell → click "Sign out" → sign-in state, nav gone               |
| A5  | shows loading state while auth pends     | **mock** (`isLoading: true` useAuth) → "Loading…", neither sign-in nor nav     |

#### B — identity seam (`convex/doctype/auth.ts`)

| #   | State                                             | Verify                                                                                            |
| --- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| B1  | derives the owner from the user half of a subject | `withIdentity({ subject: "<userId>\|session123" })` → `records.create` → stored `owner` == userId |

#### C — auth wiring (`convex/auth.ts`, `convex/http.ts`, `convex/auth.config.ts`)

| #   | State                                          | Verify                                                                     |
| --- | ---------------------------------------------- | -------------------------------------------------------------------------- |
| C1  | serves the OpenID discovery document over HTTP | `t.fetch("/.well-known/openid-configuration")` → 200, JSON issuer present  |
| C2  | declares the deployment as its own JWT issuer  | auth.config: one provider, `domain` == `CONVEX_SITE_URL`, appID `"convex"` |

#### E — query errors (#13)

| #   | State                                    | Verify                                                                                   |
| --- | ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| E1  | shows error when the doctype list fails  | real unauthenticated client, `/doctypes` → `role="alert"`, no perpetual "Loading…"       |
| E2  | shows error when the definition fails    | real unauthenticated client, `/doctypes/book` → `role="alert"`                           |
| E3  | shows error when the records query fails | **mock** (definition resolves, records reject) → `role="alert"`                          |
| E4  | shows error when the record query fails  | **mock** (definition resolves, get rejects) → `role="alert"`                             |
| E5  | shows error when delete fails            | seed + open detail, delete the record backend-side, click Delete → `role="alert"`, stays |

#### T — tracer bullet

| #   | State                                | Verify                                                                                                                            |
| --- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| T1  | signs in and builds an app zero-code | start at `/` unauthenticated → "Get started" → design a DocType → create a record → row in grid → "Sign out" → sign-in state back |

**14 rows. Row count == test count is the review invariant.** Capability-3 rows are untouched
(their tests render authenticated by default); the reworked `renderPending` keeps L4/G13/G14/D6
observing the same states through the new shell gate. The in-browser half of the tracer (a real
token from a real deployment) is manual, after § Deployment provisioning.

### Coverage

Same floor (100% lines), no new exclusions expected: `convex/auth.ts`/`http.ts` execute via C1,
`auth.config.ts` via C2, `__root.tsx` via the A rows. `src/main.tsx` remains the only excluded
entry point. If C1 proves impossible under convex-test (unknown: env-var needs of the wellknown
route), fallback is excluding `convex/http.ts` under the capability-1 entry-point policy — as a
logged deviation, not silently.

## 3. Plan

Commits: one per step, `feat(sign-in): …\n\nRefs #22.` Branch: `claude/auth-capability-ya68cl`.

**Step 1 — deps + backend.** Pin `@convex-dev/auth 0.0.90` + `@auth/core 0.37.4` as runtime
deps; add `convex/auth.ts`, `convex/http.ts`, `convex/auth.config.ts`; schema → `...authTables`;
`requireUser` → `getAuthUserId`; `tasks.ts` de-cast; `npx convex codegen --system-udfs
--typecheck disable`.
**G1:** existing convex-project tests still green; codegen drift-clean.

**Step 2 — shell.** `main.tsx` → `ConvexAuthProvider`; `__root.tsx` auth gates + sign-in/out.
**G2:** typecheck + lint clean.

**Step 3 — error branches (#13).** The four view components + Delete catch.
**G3:** typecheck + lint clean; existing web-project tests still green (fixture rework lands
here since the shell gate breaks the old `renderPending`).

**Step 4 — matrix.** Fixtures per spec; `src/routes/__root.test.tsx` (A1–A5),
`convex/auth.wiring.test.ts` (B1, C1, C2), error rows in the owning components' test files
(E1–E5), tracer in `src/zero-code.test.tsx` (T1).
**G4:** 14 new tests, 119 total green.

**G5 (coverage):** `npm run test:coverage` at 100% lines. Negative check: comment out one error
branch, confirm the floor fails, restore.

**Step 6 — close-out.** CHANGELOG `[Unreleased]`; README status; this file's deviation log;
issue #22 comment; PR.
**G6:** full battery — lint, format:check, typecheck, test:coverage, build, both codegen drift
checks — then CI green.

### Deployment provisioning (human step — after merge, before the browser tracer)

Convex Auth needs key material on each deployment (research §4); neither exists yet:

```bash
cd apps/web
npx @convex-dev/auth            # dev deployment (uses CONVEX_DEPLOYMENT from .env.local)
npx @convex-dev/auth --prod     # prod (gregarious-fox-422); alternatively run once with
                                # CONVEX_DEPLOYMENT set to prod — see the setup guide
npx convex deploy -y            # push functions/schema (runbook #25 rule: convex/** changed)
```

Set prod `SITE_URL` to the Railway URL (https://web-production-dea3d.up.railway.app). Then the
browser tracer: open the Railway URL → Get started → design a DocType → record → grid → edit →
delete → sign out.

Non-interactive alternative (added with the E2E suite): `node scripts/provision-auth-env.mjs`
generates the same key material via `npx convex env set` against whatever deployment the
environment points at — no login prompt. Use `E2E_SITE_URL` to override the `SITE_URL` value.

### Rollback / risk notes

- **convex-test can't execute Convex Auth's function set** (auth.ts registers real
  actions/mutations): nothing in the matrix calls `api.auth.signIn` — fixtures toggle client
  state; if merely _registering_ the modules breaks the in-memory backend, exclude
  `convex/auth.ts`+`http.ts` from the test module glob and from coverage (logged deviation).
- **`authTables` schema collision with existing `users` rows**: fields are all-optional, so
  dev/prod data validates; if prod deploy rejects, the fallback is a widen-migrate pass — but
  no code writes non-auth fields to `users`, so this should not trigger.
- **Anonymous user growth**: every sign-out+sign-in mints a new user row — accepted for now;
  authorization capability owns retention/upgrade flows.

### Deviations discovered during implementation

1. **The coverage-question mark resolved cleanly** — no exclusions needed: convex-test's
   `t.fetch` serves the discovery document (C1) with `CONVEX_SITE_URL` stubbed, and merely
   registering Convex Auth's function set doesn't disturb the in-memory backend (the § Rollback
   risk didn't materialize).
2. **Negative coverage checks need the dead statement on its own line** — v8 line coverage
   counts a line as covered when _any_ statement on it executes, so an unreachable `return`
   sharing a line with an executed `if` doesn't trip the floor. First attempt at the G5
   negative check passed spuriously; isolated on its own line it failed as intended.
3. **The tracer's "manual half" got automated** (owner request, same session): the Playwright
   suite ([docs/e2e-testing.md](../../e2e-testing.md)) runs the sign-in → zero-code loop against
   a real local Convex deployment with real JWTs — research §6's "token issuance is verified in
   the browser" now happens in `npm run test:e2e`, not by hand. The deployed-app walkthrough
   after provisioning remains the release check.
