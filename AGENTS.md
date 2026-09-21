# Collaboration Protocol

This repository uses a coordinator-and-workers workflow whenever the owner is
working with an agent. For those sessions, this protocol supersedes contrary
default guidance to implement directly in the main thread.

## OpenSpec is mandatory

OpenSpec is Featherbase's sole behavior specification and mandatory change
workflow. `openspec/specs/` is the only active behavior-contract root; design
notes may preserve alternatives and reasoning, but are never a second contract.

- **New feature or behavior:** create and strictly validate an OpenSpec change
  before implementation. Implement from its requirements and scenarios.
- **Existing feature without an OpenSpec capability:** first reverse-engineer
  current behavior into a baseline under `openspec/specs/`, verify it against
  the deciding code and asymmetric tests, and commit that baseline separately.
  **The baseline commit must not modify application behavior or expected test
  outcomes.** Only after that commit, create and apply a separate OpenSpec
  change for the intended behavior modification.
- Code and asymmetric tests cite the same descriptive requirement or scenario
  slug with `@spec <slug>` at the deciding line and checking test. Run
  `pnpm check:specs`; strict OpenSpec validation proves structure, while the
  STC check proves linkage—not semantic agreement.
- Use the repository-pinned CLI through `pnpm exec openspec`. When upgrading
  OpenSpec, change the exact dependency and refresh the generated workflow
  files with that same version in one reviewable change.

The rationale is [ADR 0010](docs/adr/0010-openspec-change-workflow.md). Legacy
files under `docs/specs/` are frozen, non-authoritative migration evidence;
never add a new behavior specification there.

## Main thread

- Keep the owner's main thread as the active reporting and decision point,
  focused on management, discussion, design input, decisions, and integration.
  Do not archive or deliberately close it while coordination is ongoing;
  “active” does not guarantee a continuously running executor.
- Do not use the main thread as the implementation workspace. Create one or
  more implementation threads, choosing their agent modes to match the work's
  complexity. Use one worker for coupled work; add workers only for independently
  specifiable workstreams, never as speculative or redundant fan-out.
- Give each implementation thread a directly owned task and ask it to report
  its result back to the main thread. The main thread remains responsible for
  decisions, integration, verification, and communication with the owner.
- Before launching a worker or reviewer, choose an executor that can access the
  required state and define the handoff: a committed base, explicit file or
  changes transfer, or another concrete integration path. Orb threads start
  from the project default branch and cannot see the coordinator's uncommitted
  work; reports do not transfer files.
- Active coordination does not require polling. Continue useful management or
  discussion work while workers run, and have workers report back when finished.

## Coordination cadence

- Launching an implementation or review thread must not unnecessarily pause
  the main thread. Move to the next PR, decision, or independent workstream
  while delegated work runs, unless its result is a prerequisite.
- Whenever stopping for owner input, offer concrete next-step options. Include
  choices such as waiting for active work, proceeding to the next item, or
  opening additional independent paths when applicable, so the owner can
  choose how much parallel work to engage with.
- For owner-facing decisions or questions that require a choice, give enough
  context to decide: explain why it matters, state a recommended option when
  one is warranted, and link any directly relevant issue or PR.

## Review gates

- Every accepted final or consolidated code change must be reviewed in its
  final form by someone other than its author before merge. Use the repository's
  configured code-review skill when available. A worker's self-review is not
  the independent review, and the reviewer must have the actual final diff,
  not only the worker's report. When findings cause changes, the independent
  reviewer—or another independent reviewer—must review the resolution or final
  delta; this is one converging review gate, not recursive review of review fixes.
- Re-run the relevant verification in the main thread after delegated work;
  worker reports are claims, not acceptance evidence.
- For architectural, cross-cutting, high-risk, or materially ambiguous work
  that presents a material design or correctness question, consult Oracle with
  a concrete scoped question before implementation and again on the final
  result. Resolve substantive findings before merge. Do not use Oracle for
  broad reassurance or as a substitute for direct investigation.

Implementation threads must do their assigned work themselves and must not
create further threads unless the owner explicitly requests nested delegation.

## Automatic definition of done: Prove Before Handoff

Before any development build is offered to the owner, run the project skill
`.agents/skills/proving-before-handoff/SKILL.md`: Prepare, Prove, then Hand off.
A build is not done merely because it compiles or its focused tests pass.

The owner gives standing authorization to reset **only after positively identifying**
a local Featherbase database stamped `development`, with the PostgreSQL server
itself directly local. A loopback URL alone is not sufficient. This narrow
authorization explicitly excludes SSH tunnels, port forwards, reverse proxies,
transparent proxies, shared development databases, QA, staging, production,
external services, and production data.
