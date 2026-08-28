# Featherbase — Agent Instructions

You are building a metadata-driven low-code app platform on a JS/TS stack.
The project started by replicating [Frappe Framework](https://frappe.io/framework)
faithfully — that phase is complete, the stack and architecture inspiration
remain credited to Frappe, and much of the design below still traces back to
it. The project is now in a deliberate second phase, diverging from Frappe's
design (vocabulary and API shape included) where it doesn't serve this
platform's own users. Read `docs/ROADMAP.md` for the strategy and
`docs/adr/` for the decisions already made. This file is your standing
protocol — follow it every session.

The project was developed under the working name `frappe-clone` and became
Featherbase in July 2026. That name now survives only where it is a dated
record of the past, and every one of those is deliberate — do not sweep them:

- dated `PROGRESS.md` entries, and the generated `site/*.html` dumps of them;
- `docs/adr/0006-stack-react-hono-postgres.md`, which records the working name
  as part of the decision it documents;
- `docs/research/frappe-architecture.md`, where `frappe_clone` is a
  *filesystem path* to an upstream Frappe checkout — unrelated to this project
  and not to be renamed;
- the archived harness's `diff-request.sh` and the `clone.json` evidence file
  it writes (`docs/archive/harness-2026/`), where "clone" names an artifact
  the harness emitted, not the product.

Anywhere else — anything a user reads, and any prose that speaks in the
present tense — the product is Featherbase. Describing its *history* as a
replication of Frappe stays accurate and is not the old name resurfacing.

## Project stage — experimental, nothing is deployed

**This product is not deployed anywhere and has no users. Everything is free
to change.** There is no install base, no production database, no external
consumer of any URL, API shape, table name, or wire format. Treat every
interface as provisional.

So: when a name, route, schema, or contract is wrong, **change it outright**.
Do not add redirects, aliases, deprecation shims, compatibility flags, or
dual-write paths to preserve the old shape — that is machinery paid for by a
migration burden this project does not have, and it leaves the retired shape
in the codebase forever for every future reader to reason about. Migrations
that converge an existing *local* database are still expected (developer
checkouts are real); compatibility with anything *outside* the repo is not.

Revisit this section when the first real deployment happens — from that point
the calculus changes.

## The document set (ratified 2026-08-28)

> Judgment lives in the spec, mechanics live in one living doc, history
> lives in append-only logs, and every relationship between documents is
> checked by CI rather than maintained by discipline.

Here that means: `docs/specs/` carries the judgment and the acceptance
criteria, with an evidence matrix in which no verdict stands without naming
its proof; `docs/TESTING.md` is the single living doc for how the suites are
built and run; `PROGRESS.md` and `docs/adr/` are the append-only history —
what happened, and what was decided and why. The relationships between them
are CI's job, not a reviewer's memory.

The anti-pattern this retires: **a document that describes another artifact
at a distance will drift**, and nothing catches it. Statuses, inventories
and checklists kept by hand go stale the moment the code moves and then read
as current — which is why the 2026 build harness is now archived
(`docs/archive/harness-2026/`). If a claim about the codebase cannot be
checked mechanically, do not write it down as a fact; put it where history
belongs, dated.

## Architecture invariants (never violate these)

1. **Everything derives from Table metadata.** Models are JSON definitions
   stored in the `table_def` table. Tables, APIs, forms, list views,
   validation schemas, and RLS policies are all *generated* from that JSON.
   Never hand-write a per-model table, endpoint, or form component.
2. **All reads and writes go through the server** (`apps/server`); clients
   never talk to Postgres directly. Every mutation calls the server's
   row-save/submit/cancel/delete operations, which run the full automation-
   trigger chain (on check → before saving → DB write → after saving) in one
   transaction, including sub-tables and id patterns.
3. **The Admin UI is generic.** One `ListView` and one `FormView` render
   every Table from its metadata. Adding a Table requires zero frontend
   code.
4. **Frappe wire-format compatibility is NOT a goal.** This project began as
   a faithful Frappe replication (an intentional exercise, completed) and
   has since moved into a deliberate second phase of diverging from Frappe's
   design — including vocabulary and API shape — where it doesn't serve this
   platform's own users. Do not reintroduce Frappe-specific wire shapes
   (`exc_type`, `frappe.client.*`, `/api/method/<dotted.path>` RPC naming,
   etc.) for compatibility's sake — they were removed on purpose.

> `docs/ROADMAP.md` still describes a React + Supabase stack. That is the
> original plan, not the implementation. Features it frames in terms of
> Supabase / PostgREST / Supabase Auth / Supabase Realtime are satisfied here
> with local equivalents: native Postgres RLS, server-issued JWTs, server
> websockets, and disk-backed file storage. See
> [ADR 0006](docs/adr/0006-stack-react-hono-postgres.md).

## Stack

- `apps/server` — Node + Hono + TypeScript, the [`postgres`](https://github.com/porsager/postgres)
  client (not an ORM), Zod for validation, `ws` for realtime, Playwright for
  server-side PDF printing
- `apps/web` — React 19 + Vite + TypeScript, TanStack Router + TanStack Query,
  Tailwind v4. There is **no** shadcn/ui and **no** react-hook-form — UI is
  built from the shared `.fc-*` component classes described in `PROGRESS.md`
- `packages/shared` — types and contracts used by both sides
- [`feather-testing-postgres`](https://github.com/siraj-samsudeen/feather-testing-postgres)
  — the SQL Sandbox test harness, consumed as a published npm dependency. It
  lives in its own repo; fix it there and release, never vendor it back in.
  *Temporarily pinned to a git commit* — `59b7b84`, which teaches `seed()`
  the Table/Row wire (`POST /api/save_row { table, row }`) and corrects its
  `{ name }` return type to `{ row_id }`. That work merged to the harness's
  `main` on 2026-08-14 (its PR #3), but the repo has published no release
  yet, so the pin stays and `apps/web/test/pg-test.ts` still carries two type
  shims for the stale published shapes. Move both `package.json`s to a
  version range and delete the shims on the first release (issue #225; the
  2026-07-31 and 2026-08-14 `PROGRESS.md` entries)
- Monorepo — pnpm workspaces; boot everything with `./init.sh`

**Visual identity is a standing directive.** Every new UI feature must inherit
the Frappe-inspired Admin look — design tokens and the `.fc-card` / `.fc-input` /
`.fc-btn` component classes. The rules are at the top of `PROGRESS.md`; read
them before writing any UI.

## Environment

- **Database:** whatever `DATABASE_URL` points at — by default the local
  Postgres on **port 5432**, database **`featherbase`**. There is no `.pgdata`
  directory and nothing runs on 5433.
- **`./init.sh` never manages a Postgres that already answers.** It probes
  `DATABASE_URL` first; only if that fails does it try to start a cluster
  (Debian `pg_ctlcluster`, macOS `brew services`) and then create the role and
  database over whichever superuser connection the host accepts — the current
  login user on Homebrew, `su postgres` when running as root in the container.
  So it works on macOS and Linux alike, and is a no-op once things are up.
- **Connection strings** default in `apps/server/src/config.ts`; override with
  `DATABASE_URL`. The RLS suite connects as the `app_client` role and
  overrides with `RLS_TEST_URL`.
- **Servers:** API on `:8000`, web on `:5173`. `./init.sh` kills stale
  listeners by port and waits for both to answer.
- **Chromium is resolved from the environment, never hardcoded.** Both
  `apps/web/playwright.config.ts` and `apps/server/src/print.ts` let Playwright
  resolve its own installed browser unless `CHROMIUM_PATH` names one; `print.ts`
  additionally scans `PLAYWRIGHT_BROWSERS_PATH` (defaulting to the container's
  `/opt/pw-browsers`) when that directory exists. Set `CHROMIUM_PATH` if you
  need a specific binary — do not reintroduce a literal path.

## Testing

`docs/TESTING.md` is the living doc — how the suites are built, run and
extended. What follows is only the part you must not get wrong from memory.

Every test runs inside a real Postgres transaction that is rolled back at the
end — Phoenix's Ecto SQL Sandbox model, via `feather-testing-postgres`. No
mocks, no fixture files, no cleanup code.

Both suites set `fileParallelism: false` on purpose: all test files share one
database and one `background_job` queue, so parallel files steal each
other's jobs and contend on id-pattern row locks. Do not turn it back on.

`background_job` is the one piece of state that outlives a run — a run
killed partway through leaves `queued` rows behind, and the next run then sees
a higher `drainJobs()` count than the test expected. A Vitest `globalSetup`
(`apps/server/test/global-setup.ts`, shared by both suites) empties the queue
once per run, outside any sandbox transaction. It complements
`fileParallelism: false` rather than replacing it.

- `pnpm test` — every suite
- `pnpm smoke` — server + web smoke tests
- `pnpm --filter server typecheck`

## Session protocol

1. **Orient.** Read `PROGRESS.md` (newest entry first), `git log --oneline -20`,
   the open issues labelled `ready-for-agent` (`gh issue list --label
   ready-for-agent`), and `docs/specs/`. Do not re-derive decisions already
   recorded in `docs/adr/`.
2. **Boot & smoke-test.** Run `./init.sh` and verify the app actually starts and
   the core flow passes (login → open a Table list → open a form) BEFORE
   writing new code. If the app is broken, fixing it IS the session's task.
3. **Pick ONE piece of work.** Take direction from the `ready-for-agent`
   issues, `docs/specs/` (a spec with no evidence is a backlog item),
   `docs/design/execution-plan.md` (milestones M1–M5), and the "next" note at
   the end of the latest `PROGRESS.md` entry. Do not start a second thread of
   work in the same session.
4. **Implement it fully.** Small, complete, working — not broad and half-done.
5. **Verify end-to-end.** Exercise it the way a user would: HTTP calls against
   the running server, and the browser via Playwright for UI. Unit tests alone
   do not count.
6. **Update state.** Only after verification: append a dated entry to
   `PROGRESS.md` (what was done, how it was verified, what to pick up next, any
   gotchas), and commit. Leave the working tree clean.

### Accepting delegated work

When you coordinate and someone else — a sub-session, a task chip, another
agent — hands back finished work, run its stated verification commands
yourself before you accept it. A report is a claim, not evidence: the agent
that wrote the code is the worst-placed party to certify it, and a committed
"done" has twice failed its own typecheck on rerun. Read the report for what
to check and where; get the verdict from the commands. If the report names no
command, that is the first finding.

## Hard rules

- **Nothing is `done` on an agent's word.** A claim is finished when a
  command someone else can run says so. Record the command, not the verdict.
- Never leave the app in a non-booting state at the end of a session. If you run
  out of time mid-change, revert or stash to the last working state and record
  where you stopped in `PROGRESS.md`.
- Commit at every stable point, not just at session end.
- Keep `./init.sh` working at all times; if setup steps change, update it in the
  same commit.
- **No expectation laundering.** An agent must not change an existing
  expected outcome and its implementation merely to obtain a passing run,
  unless an approved requirement or decision authorizes the behaviour
  change. (New tests with new code in one change is normal work; weakening
  an assertion to make broken code pass is the thing this forbids. Tests
  marked `it.fails`/`test.fail` pin known defects by issue number, with the
  SPEC in the assertion: fixing the defect makes the pin fail on purpose —
  flip it to a plain test in the same change.)
- **A discovered behaviour is not a requirement.** It has three fates —
  ratified into the spec, filed as a defect, or raised as an open question —
  and choosing is the owner's call, never an agent's. See
  `docs/design/requirements-framework.md`.

## Where decisions live

- `docs/adr/` — architecture decisions. [ADR 0006](docs/adr/0006-stack-react-hono-postgres.md)
  records the move to React + Hono + Postgres and supersedes 0001–0004.
- `docs/VISION.md` — what this is for and who it serves.
- `docs/specs/` — requirements for work agreed but not yet built, in
  feather-spec form (EARS criteria + example tables). Capability IDs there
  (`EDS-1`, `VDT-3`) are the traceability handles — use them in commits, bugs
  and review comments.
- `docs/research/` — Frappe architecture, Glide, and stack studies.
- `docs/archive/` — frozen history: the 2026 build harness and its feature
  inventory (`harness-2026/`), and the specs from the retired Convex
  implementation (`convex-capabilities/`, preserved on the `archive/convex-v1`
  tag). Read for lineage; never as a statement about today's code.

## Agent skills

### SDLC skill routing (owner directive, 2026-08-11)

Use the mattpocock-skills plugin at the matching lifecycle stage — invoke
the skill, don't improvise the equivalent:

| Stage | Skill |
|---|---|
| Building a feature or fixing a bug test-first | `mattpocock-skills:tdd` |
| Diagnosing a bug, failure, or perf regression | `mattpocock-skills:diagnosing-bugs` |
| Reviewing a PR, branch, or "changes since X" | `mattpocock-skills:code-review` (Standards + Spec axes) |
| Answering a design question with throwaway code | `mattpocock-skills:prototype` |
| Designing or deepening a module interface/seam | `mattpocock-skills:codebase-design` |
| Pinning domain vocabulary or recording an ADR | `mattpocock-skills:domain-modeling` |
| Delegating reading/API-fact gathering | `mattpocock-skills:research` |
| Resolving an in-progress merge/rebase conflict | `mattpocock-skills:resolving-merge-conflicts` |
| Stress-testing a plan before committing to it | `mattpocock-skills:grilling` |

Requirements documents still use the featherbase-local `journey-spec`
skill, not a plugin. When spawning sub-sessions or task chips, name the
required skills in the prompt — spawned agents read this file, but an
explicit instruction survives context loss.

### Issue tracker

Issues live as GitHub issues in `siraj-samsudeen/featherbase`, driven through
the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name
(`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`,
`wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one root `CONTEXT.md` plus `docs/adr/` for the whole
monorepo. See `docs/agents/domain.md`.
