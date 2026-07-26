# Execution Plan — from the design framework to working slices

> 2026-07-26. Companion to `data-and-admin-topology.md` (the *what*);
> this is the *how and in what order*, written against a specific
> history: 4–5 attempts at Featherbase over 1.5 years where big plans
> produced disappointment and technical debt. The plan's job is to make
> that failure mode structurally hard.

## 0. Why past attempts failed — and what already works

The failure pattern was never "the code was bad"; it was **the unit of
promise was too large**: framework-first building, horizontal layers
with no user, verification deferred to "later", agents promising a
platform and delivering a demo.

The counter-evidence is **this repo itself**: 126 harness features got
built and verified because the harness forced small units — one feature,
exercised end-to-end, PROGRESS entry, app never left broken. The plan is
therefore not a new methodology; it is *the harness discipline applied
to the design doc*, with real client deliverables as the forcing
function.

## 1. Operating rules (the anti-disappointment contract)

1. **Product slices, not framework layers.** Never build a framework
   capability except as the smallest version some real slice needs this
   week. The framework is what's left behind after slices ship.
2. **One feature per session** (existing CLAUDE.md protocol). A feature
   has a written verify step before code starts. No "passing" without
   end-to-end exercise. App boots green at session end, always.
3. **Spec → validate → build.** Each milestone gets a feather-spec
   (specs 0001/0002 are the templates, with their definition-of-done
   sections). The spec is validated against the design doc's axes and
   D-decisions *before* implementation — this is the "agent breaks it
   down, then comes back for validation" loop, made concrete: the
   breakdown artifact is a spec + feature list with verify criteria,
   and validation is checking it against D1–D21 and cutting scope.
4. **Refactor only at the seam, under green tests.** The existing suite
   (382 server tests, e2e) is the refactoring safety net. Refactors that
   aren't required by the next slice are banned.
5. **A visible NOT-NOW list** (kept below). Scope creep is rejected by
   pointing at it, not by argument.

## 2. The three real use cases, in rising write-risk order

Available today, each forcing a different slice of the design doc:

- **A. Warehouse browser** — a large MotherDuck warehouse serving
  clients, currently SQL-only. Read-only: lowest risk, immediate client
  value. Forces: connection registry, `duckdb` driver, foreign mode,
  reflection, read-only Desk (spec 0001's read-only slice; §3.3 v7).
- **B. dbt seeds → MDM** — mapping/seed tables hand-edited in the dbt
  repo, wanting a governed editing UI. First *writes*, tiny tables.
  Forces: native/adopted DocTypes with audit columns, D20's generator
  emitting the seed CSVs back into git.
- **C. Report-feedback API** — already live: main's app-platform entry
  records a report server POSTing feedback rows over REST as
  Featherbase's first external consumer (issues #54–#57 came from it).
  Forces: nothing new — it is the *proof pattern*: real consumers find
  real gaps; keep feeding it use cases.

## 3. Milestones

Each = one feather-spec, ~5–10 features, every feature independently
verifiable. If a spec exceeds ~10 features, cut the milestone, not the
verification.

**M0 — the seam refactor (framework, kept minimal).**
`table_name` moves into DocType metadata with derived default (D2);
the storage-adapter interface extracted with `postgres` as the only
driver (D5/D7), dispatched per-DocType. *Verify: the entire existing
suite passes unchanged; zero behavior change; `tableName()` callers all
route through metadata.* This is the only permitted "pure framework"
milestone, and it exists because A and B both need the seam.

**M1 — warehouse browser MVP (use case A).**
Register a MotherDuck connection (env-var token), `duckdb` driver
(read + introspect capabilities only), reflect one bronze schema into
read-only DocTypes grouped as a Desk module, generic list/form with
filters/sort/pagination pushed down; spec 0001's read-only-source and
allowlist rules. *Verify: browse a real client bronze table in the
Desk; a permission-less user gets 403; a dbt-driven table reshape shows
up in drift re-sync; no DDL was ever issued (schema snapshot before ==
after).*

**M2 — seeds become master data (use case B).**
Pick 2–3 real dbt seed tables. Recreate as native DocTypes (audit
columns on), edit rows in the Desk, and a D20 generator emits the seed
CSVs (byte-stable format) into the dbt repo via branch + PR. *Verify:
`dbt build` consumes the generated seeds with zero diff-noise; a Desk
edit arrives as a reviewable PR authored as the acting user; the old
hand-edited files are retired.*

**M3 — egress config generation (use case B extended).**
From the same DocTypes, generate the bronze/silver onboarding config
(current CSV format) and dbt `sources.yml` + staging models. *Verify:
generated artifacts byte-match the hand-written ones for the migrated
tables (or the diff is an agreed improvement); regeneration after a
DocType field-add updates them correctly.*

**M4 — reassess against the design doc.** Only now consider the next
axis investments (saved views for M1's analysts, module-admin roles,
SAP push binding, effectivity). Each becomes its own spec through the
same loop.

## 4. The agent workflow per milestone

1. **Plan session** (one): produce/refresh the feather-spec + feature
   list with per-feature verify commands. Output is reviewed against
   D1–D21 — wrong-layer features get cut here, which is where
   over-promising dies.
2. **Build sessions** (N): one feature each, harness rules, commit at
   every stable point, PROGRESS entry with what/how-verified/next.
3. **Review**: small PRs per milestone (not per feature); code review +
   the spec's definition-of-done checked item by item; merge only green.
4. **Ownership pass** (the "understand completely" requirement): after
   each milestone the owner reads the diff end-to-end and writes the
   PROGRESS "gotchas" entry personally — if it can't be explained, it
   gets simplified before the next milestone starts.

## 5. NOT-NOW list (rejections by pointer)

Plugins/marketplace mechanics (D10–D15 stay *disciplines*: manifest
shapes and no private APIs — no plugin manager built); bidirectional
sync + survivorship; Convex/InstantDB drivers; type/field-set machinery
(D4) until the helpdesk app; environments/promotion tooling (D17)
beyond git; effectivity dating (D16) until an MDM entity needs it;
portal surfaces; multi-site anything; eject-to-code.

## 6. What "avoid technical debt" means here, concretely

Debt in past attempts came from *unverified breadth*. Under this plan
the only breadth is the design doc (which is paper, and cheap), and
every line of code exists because a shipped slice needed it, is covered
by the suite that already exists, and was reviewed against a spec with
a definition of done. The design doc absorbs ambition; the codebase
only ever absorbs verified slices.
