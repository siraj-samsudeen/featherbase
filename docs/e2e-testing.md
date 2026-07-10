# End-to-end testing (Playwright)

Added 2026-07-10 (owner request, capability-4 session): every user-facing feature exercised in a
real browser against a real Convex backend — real anonymous users, real JWTs, no identity
injection. This automates the browser half of capability 4's tracer bullet, which until now was
a manual post-deploy checklist.

## Where E2E sits in the testing philosophy

The [testing conventions](research/feather-testing-study.md) are unchanged: the vitest
integration matrix (one test per MECE state, real in-memory backend) owns correctness and owns
the **100% line-coverage floor** — enforced by `npm run test:coverage`, already green. Playwright
runs the built app in a separate browser process, so it does not (and cannot) feed that v8
metric; its job is **real-browser confidence over full journeys** — real auth tokens, real
websockets, real navigation, real constraint validation. Per the philosophy, E2E deliberately
overlaps the integration layer on critical journeys instead of slotting into the MECE matrix.
"100% coverage" at this layer means: **every user-facing feature appears in the journey matrix
below** — row count == test count, same review invariant as the vitest matrices.

## Running

```bash
npm run test:e2e   # boots everything itself; first run downloads nothing if cached
```

`apps/web/playwright.config.ts` starts `scripts/e2e-server.sh` as its `webServer`, which:

1. pushes functions/schema to an **anonymous local Convex deployment**
   (`CONVEX_AGENT_MODE=anonymous npx convex dev` — no Convex account; backend binary cached
   under `~/.cache/convex/binaries/`),
2. provisions Convex Auth key material if missing (`scripts/provision-auth-env.mjs` — the
   non-interactive equivalent of `npx @convex-dev/auth`: generates an RS256 pair, sets
   `JWT_PRIVATE_KEY`/`JWKS`/`SITE_URL`),
3. runs `convex dev --start vite` and restores the canonical `convex/_generated` on exit (dev
   mode rewrites it in a form the CI drift check rejects — CLAUDE.md gotcha).

One worker, and specs only touch DocTypes they created under unique machine names: the local
deployment's data persists across tests **and runs**, so global empty states are asserted only
in the vitest matrix, never here.

Sandbox notes: remote sandboxes pre-install Chromium at `/opt/pw-browsers/chromium` (the config
auto-detects it; browser downloads are blocked). If the GitHub release download of the backend
binary is blocked, the same binary ships inside `ghcr.io/get-convex/convex-backend:<commit>` —
extract `convex/convex-local-backend` from the image layer matching the CLI's requested
`precompiled-<date>-<commit>` version into `~/.cache/convex/binaries/<version>/`.

## Journey matrix

One test per row, real backend throughout; the only non-real element anywhere is nothing — no
mocks at this layer by construction. Files under `apps/web/e2e/`.

### P — sign-in (capability 4, the tracer's browser half) — `auth.spec.ts`

| #   | Journey                                              | Verify                                               |
| --- | ---------------------------------------------------- | ---------------------------------------------------- |
| P1  | shows the sign-in gate to an unauthenticated visitor | `/` → "Get started", no nav                          |
| P2  | signs in anonymously and enters the shell            | click → Sign out button + tasks view                 |
| P3  | keeps the session across a reload                    | reload → still in the shell (real token persistence) |
| P4  | signs out back to the gate                           | Sign out → gate; still the gate after reload         |

### T — tasks demo (capability 1) — `tasks.spec.ts`

| #   | Journey                                   | Verify                                          |
| --- | ----------------------------------------- | ----------------------------------------------- |
| P5  | adds a task that persists across a reload | add → in list → reload → still there (per-user) |

### D — DocType designer + list (capabilities 2–3) — `doctypes.spec.ts`

| #   | Journey                                                    | Verify                                                                                             |
| --- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| P6  | designs a DocType with every field type, lands on its grid | text req+filterable / number / boolean / select+options / plain; heading, filter options, New link |
| P7  | rejects a duplicate DocType name inline                    | same name again → "already exists" alert, still on designer                                        |
| P8  | lists the DocType and opens its grid from the list         | `/doctypes` → label link → that DocType's grid                                                     |
| P12 | shows the unknown-DocType message                          | `/doctypes/<ghost>` → Unknown DocType                                                              |

### R — records: grid, form, detail (capability 3 over capability 2) — `records.spec.ts`

| #   | Journey                                                 | Verify                                                                   |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------ |
| P9  | creates records through the generated form, typed cells | number cell, boolean → Yes, unset → blank                                |
| P10 | sorts a numeric column and clears back to all records   | asc (unset row hidden — sidecar semantics) → desc → third click restores |
| P11 | filters by a select option and clears the filter        | genre=fiction → 1 row; Clear → all                                       |
| P13 | edits a record from the detail view, grid updates       | system fields shown; change value → saved in grid                        |
| P14 | deletes a record from the detail view                   | grid back to empty state                                                 |
| P15 | shows record-not-found for a stale record URL           | deleted record's URL → "Record not found"                                |

### Z — tracer — `zero-code.spec.ts`

| #   | Journey                                                  | Verify                                                       |
| --- | -------------------------------------------------------- | ------------------------------------------------------------ |
| P16 | runs the zero-code loop end to end behind a real sign-in | gate → design → create → edit → delete → sign out — no stubs |

**16 rows, 16 tests.** Not in this matrix by design: loading/error/empty **states** (owned by
the vitest matrices — mock-only or unreachable against a healthy real backend) and anything the
UI can't reach (promotion ladder, hooks beyond what the designer exposes — backend-matrix
territory).

## CI status

Not wired into `ci.yml` yet: the job needs the backend-binary download plus a Playwright browser
install, and per the deployment-runbook lesson (#25) untested CI is how red runs happen. Wiring
it in (as a separate job so the core gates stay fast) is logged as a follow-up.
