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

## Review protocol (added 2026-07-09, from the PR #9 review session)

Every capability PR gets an agent review at two possible levels:

1. **PR review** — every capability PR. Scope: correctness of the diff, contract fidelity
   against the capability spec and the layers it calls into (read the actual backend code the
   UI/feature depends on — don't trust the PR description), test-matrix honesty (row count ==
   test count, **and** whether the tests observe the behaviors they claim — e.g. every sort test
   seeding the sorted field hides what happens when it's unset), and UX/behavior edges the
   matrix missed.
2. **Drift audit** — at user-facing milestones (first shipped UI, first deploy, ~every 3
   capabilities), or on request. Scope: the whole codebase against the four VISION.md
   invariants (verify each is *enforced*, not just claimed — property tests, seams held by
   construction); every ADR promise classified as delivered / deferred-and-logged / **silently
   dropped** (the last is the finding); leave-out ledgers checked for completeness; and forward
   flexibility against the next two roadmap capabilities (what will they press on — data
   volume, type unions, auth paths — and does the current shape survive it).

Findings are severity-gated at review time, then filed the same day:

- **Pre-merge fixes:** only findings that are cheap **and** affect correctness of what ships.
  Everything else must not block the merge — no nitpicking mode; the next capability's tracer
  bullet is a better test of whether a finding matters than pre-emptive polish.
- **Issues, not session memory:** one umbrella issue per review level, sub-issues for
  substantive items, cosmetics bundled into a single issue. Every issue self-contained (file
  paths, symptom, fix sketch) so a cold agent can execute it without the review session.
  Structural findings say which capability's research they feed into.
- **Sweep cadence:** capability close-out (plan step 7) spends a fixed slice on open follow-up
  issues; structural findings get pulled into the next capability's research step instead of
  being fixed ad hoc.

First application: #10 (capability 3 PR review) and #15 (capabilities 1–3 drift audit).
