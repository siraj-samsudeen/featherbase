# Agent Harness

This directory implements the long-running-agent harness described in
Anthropic's engineering posts
([Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents),
[Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)),
applied to building a Frappe Framework clone.

## Why a harness

Long-running agents work in discrete sessions with no memory between them.
Left alone they declare victory early, leave the app broken mid-session, and
burn context rediscovering state. The harness fixes this with durable,
structured state in the repo and a strict per-session protocol.

## The pieces

| Artifact | Role |
|---|---|
| `features.json` | The full feature inventory (126 features). Ground truth for "what's done". Agents may ONLY flip `status` between `failing`/`passing` — never edit entries. Each feature carries its own end-to-end verification criteria and dependencies. |
| `../CLAUDE.md` | Standing rules loaded every session: architecture invariants + the session protocol. |
| `../PROGRESS.md` | Session-to-session handoff notes (the "structured handoff" replacing context compaction). |
| `../init.sh` | One command to boot database + server + web and smoke-test them. Sessions verify the app works BEFORE coding. |
| `prompts/initializer.md` | One-time environment setup agent (scaffold, DB, init.sh, smoke test). |
| `prompts/coder.md` | The per-session generator: orient → boot → one feature → verify end-to-end → record → commit. |
| `prompts/evaluator.md` | Adversarial verifier (generator/evaluator pattern): re-drives recently-passed features via the public interface and flips false claims back to `failing`. |
| `run.sh` | The outer loop: initializer once, then coder sessions with an evaluator pass every N sessions, pushing after each. |

## Running it

```bash
# one-time: authenticate the claude CLI, then
harness/run.sh 50            # up to 50 coding sessions
EVAL_EVERY=2 harness/run.sh  # stricter evaluation cadence
```

Progress is measured by `failing` counts in `features.json`; history and
rationale live in git log and `PROGRESS.md`.

## Design notes

- **Fresh context per session, state in the repo** — full context resets with
  structured handoffs outperform compaction for multi-day builds.
- **One feature per session** — small, complete, verified increments beat
  broad half-done sweeps.
- **The feature list is immutable except for status** — otherwise agents
  "simplify the spec" instead of finishing it.
- **Verification is end-to-end by construction** — every feature's `verify`
  field describes user-visible behavior against the running app, and the
  evaluator re-drives it adversarially (works for non-admin users, works on a
  second DocType, survives edge cases).
