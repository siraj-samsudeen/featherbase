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

## 2. The real use cases (all available today)

- **A. dbt seeds → MDM** — mapping/seed tables hand-edited in the dbt
  repo *only because there was no edit UI*. They become plain native
  DocTypes; a generator emits the seed CSVs (and later the
  bronze/silver config) back into git. **Needs zero framework change** —
  native DocTypes and their whole engine already exist.
- **B. The external CRUD manager retires** — tables currently managed
  through a separate CRUD tool move into DocTypes (import → edit in
  Desk → retire the tool). Also native; a second low-risk write case
  that grows the MDM's real content.
- **C. Warehouse browser** — the MotherDuck warehouse (bronze/silver/
  gold), currently SQL-only, becomes browsable read-only in the Desk.
  First *foreign* source: needs the read-only half of the storage seam.
- **D. Report-feedback API** — already live: main records a report
  server POSTing feedback over REST as the first external consumer
  (it drove #54–#57). The proof pattern — keep feeding it use cases.

## 3. Milestones (concrete value first; refactor when informed)

Sequencing principle, per the owner: start with the two concrete,
fully-ownable slices that need no framework surgery; meet the seam only
when the browser forces it; do the *full* refactor last, informed by a
real second backend instead of speculation.

Each milestone = one feather-spec, ~5–10 features, every feature
independently verifiable. If a spec exceeds ~10 features, cut the
milestone, not the verification.

**M1 — seeds become master data (use case A; no framework change).**
Pick 2–3 real dbt seed tables. Recreate as native DocTypes (audit
columns on), import current rows, edit in the Desk; a D19/D20 generator
emits the seed CSVs (byte-stable format) into the dbt repo via
branch + PR. *Verify: `dbt build` consumes the generated seeds with
zero diff-noise; a Desk edit arrives as a reviewable PR authored as the
acting user; the old hand-edited files are retired.*

**M2 — the CRUD manager's tables come home (use case B).**
Inventory what the external CRUD tool manages; recreate (or, if the
tables live outside our Postgres, adopt) as DocTypes; import; permission
them; retire the tool for those tables. *Verify: every workflow the CRUD
tool served is demonstrated in the Desk or over the REST API; row counts
and spot-checked values match post-import; the tool is switched off for
the migrated tables.*

**M3 — warehouse browser MVP (use case C; the seam arrives, half-size).**
This milestone cannot be built honestly without a seam — and the repo
already contains the cautionary tale: PLAT-008's `tenancy.ts` bolted on
a parallel path that reimplements table creation instead of reusing the
engine. **The browser must not repeat that.** So M3 introduces the
**read-only adapter seam only** — `getList / getDoc / count /
introspect` dispatched per-DocType — with the postgres driver as the
default and a `duckdb`/MotherDuck driver (env-var token) as the second
implementation; Data Source registry + reflection of one bronze schema
into read-only DocTypes grouped as a Desk module; spec 0001's read-only
and allowlist rules. *Verify: browse a real client bronze table in the
Desk; permission-less user gets 403; a dbt reshape shows in drift
re-sync; schema snapshot of the warehouse before == after (no DDL
ever); existing suite still green (the read path of local DocTypes now
flows through the same seam).*

**M4 — the full storage seam (the refactor, now informed).**
With two real backends behind the read seam, extend it to writes and
ownership modes, and migrate `tableName()` into per-DocType metadata
(D2, D5, D7) — shaped by what M3 actually needed rather than
speculation. *Verify: entire suite passes; zero behavior change for
native DocTypes; the M1/M2 DocTypes keep working untouched.*

**M5 — egress config generation + reassess.**
From the M1/M2 DocTypes, generate the bronze/silver onboarding config
(current CSV format) and dbt `sources.yml` + staging models; *verify by
byte-matching the hand-written configs* (or an agreed improvement).
Then reassess against the design doc before any new axis investment
(saved views for analysts, module-admin roles, SAP push, effectivity).

## 3b. Relationship to the harness (lineage, not extension)

The original build ran on `harness/` — features.json (126 entries, each
with its own end-to-end `verify` criterion and deps; agents may only
flip `status`), the CLAUDE.md session protocol, PROGRESS handoffs,
`init.sh` boot-proof, a coder prompt (one feature per session) and an
adversarial evaluator prompt that re-drives recently-passed features
and flips false claims back to `failing`, looped by `run.sh`.

**That harness is retired** — archived 2026-08-28 (issue #236) at
`docs/archive/harness-2026/`, statuses and all, because they were
self-attested by the sessions that wrote the code. The capability specs
in `docs/specs/` are the *successor artifact*, replicating the harness
mechanics at the next level: capability IDs (EDS-1 style) play the role
of feature IDs, each EARS criterion + example table is the `verify`
field, the spec's definition-of-done is the evaluator's checklist, and
its evidence verdicts make every claim name the proof behind it — checked
in CI by `tools/check-evidence.mjs` rather than taken on trust, which is
the part the harness only ever asked for. What the harness proved — a
spec agents cannot reword, per-item end-to-end verification, one item
per session, adversarial re-checking — is exactly what §1 carries
forward.

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
