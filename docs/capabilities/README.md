# Capabilities

One folder per capability, numbered in build order, following the convention proven in feather-testing-convex:

```
N-capability-name/
  1_research.md   ← what exists, what we learned, options considered
  2_spec.md       ← requirements: behavior, edge cases, test matrix
  3_plan.md       ← implementation steps with verification gates
```

Rules:

- Written **just-in-time** — a capability gets its folder when it's next up, not before. [ROADMAP.md](../ROADMAP.md) holds the provisional sequence.
- The spec's test matrix is authored before code (human defines states, agent fills tests — see TESTING-PHILOSOPHY in feather-testing-convex).
- If a capability's design contradicts an ADR, the ADR gets superseded explicitly (new ADR, link both ways) — never silently.

Right-sizing (added 2026-07-08 per the [decision revalidation](../research/revalidation-2026-07.md), issue #4):

- **Scale artifacts to risk.** Architecturally risky capabilities (2, 6, 8, 9) get all three files. Small or mechanical capabilities may collapse into a single `research-spec-plan.md` — the **test matrix is the only non-negotiable section**.
- **Research verifies external reality, it doesn't teach the agent.** Its job is checking live sources (registries, official docs) against assumptions, because model training data is always stale — capability 1's research catching Vitest 4's removal of `environmentMatchGlobs` is the canonical example.
- **Plans are lean living ledgers**, not prose: verification gates (with negative checks), version pins, and a deviation log updated during execution.
- **Exactly one human gate per capability**: docs posted on the issue → owner approves → implementation runs unattended to green CI. Spend review budget where the leverage is — read the test matrix closely, skim research verdicts, spot-check plan gates.
