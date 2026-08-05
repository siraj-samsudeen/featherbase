# Feature: <Name>              <!-- docs/specs/NNNN-<feature>.md -->

**IDs:** `<FEAT>-J*` journeys · `<FEAT>-R*` rules · `<FEAT>-I*` invariants
· `<FEAT>-H*` hazards · `Q*` questions
**Evidence:** `docs/specs/evidence/<feature>.csv` (never status in this file)

## The job
<FEAT>-J1 — "<the user's own words for job A>."
<FEAT>-J2 — "<job B>."

## The fixture — `<name>.csv` *(or: ## Prior state)*
<data-shaped: the agreement dataset, small, each column exercising a
different rule · residue-shaped: the state an upstream feature leaves
behind, reusing its fixture>
**Limits, stated on purpose:** deliberately benign; hostile-space coverage
lives in the rules' properties.

## <FEAT>-J1 — <title> *(shape: sequence)*
| # | Where / do | Must observably see | Rules |
|---|---|---|---|
| J1.1 | … | … | R1 |

**Branch at J1.n — <path variation>.** <only what changes>
**Isolation strategy:** <how re-runs stay honest; a skip is never a pass>

## <FEAT>-J2 — <title> *(deltas from J1 only)*

## Closure sweep
actors & permissions: <ID or (none — reason)> · prior state & lifecycle:
… · concurrency & retries: … · external failures: … · durability &
recovery: … · security & privacy: … · accessibility: … · performance &
scale: … · observability: … · compound hazards: …

## The rules
### <FEAT>-R1 — <name> · `shape: rule`
**Property:** <one sentence quantified over the whole input space>
| Input | → | Why? |
|---|---|---|

### <FEAT>-R1b — <name> · `shape: contract`
`<METHOD> /api/<address>` — the address is the contract's identity.
<enumerate behaviours; example table only where values genuinely vary>

### <FEAT>-R2 — <name> · `shape: judgement`
Conformance: <named constants, ADR ref>. Fitness: <corpus pointer + caveat>.
Anchors: <example table>

### Invariants
- **<FEAT>-I1 — <name>.** <whole-run arithmetic>

### Hazards
- **<FEAT>-H1 — <name>.** <compound risk no single rule owns>

## Open questions *(arbiter: <name>)*
| # | Question | Blocked on |
|---|---|---|
| Q1 | … | — |
