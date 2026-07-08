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
