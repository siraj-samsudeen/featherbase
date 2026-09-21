## Context

See `proposal.md` for motivation. Commit `76e48e7` installed OpenSpec as an evaluation using the machine-global CLI, generated Claude-only workflow files, one migrated capability, a second active Journey specification root, and an STC checker deliberately excluded from CI. The owner has now ruled for repository-wide adoption.

This change must not edit Tasker behavior specifications or `runtime-apps/tasker`; another worktree owns that migration. It must also avoid platform schema/router work.

## Goals / Non-Goals

**Goals:**
- Make the CLI, workflow instructions, strict validation, and traceability reproducible from a clean checkout.
- Give fresh contributors one exact route for new behavior and a two-commit baseline/change route for legacy behavior.
- Preserve dated evaluation evidence without leaving its rejected recommendation as current guidance.
- Prevent the retired specification root from regaining authority while allowing legitimate explanatory documentation.

**Non-Goals:**
- Re-specify Tasker behavior or inventory its unbuilt requirements.
- Convert every legacy Journey specification in this change.
- Claim that schema validation proves the specification agrees with code or tests.
- Replace local code/test/spec review skills that add project-specific judgment beyond generated workflow instructions.

## Decisions

### Pin OpenSpec 1.13.0 as a root development dependency

The repository will pin the exact CLI version observed and used to create this change, then call it through `pnpm exec` scripts. Exact pinning makes the lockfile, CI, generated workflow files, and artifact schema agree. Upgrades become explicit repository changes that refresh generated files and run strict validation.

Using the latest registry release implicitly was rejected because a clean install could change workflow semantics without a source diff. Depending on a global binary was rejected because CI and new contributors would not be reproducible.

### Keep one normative root and freeze the retired root

`openspec/specs` is the only current behavior authority. Existing Journey documents may survive temporarily as dated migration evidence, but guidance will call them non-authoritative and a focused guard will reject new files under `docs/specs` beyond an explicit migration baseline. The guard targets that directory, not words such as “requirement” elsewhere, so ADRs, architecture, design, and research remain available for their proper roles.

Immediately moving or deleting Tasker Journey files was rejected because another coordinated worktree owns that exact content. Treating both roots as active until every legacy document is converted was rejected because it perpetuates the ambiguity this change removes.

### Separate baseline recovery from behavior modification

For an existing feature with no OpenSpec capability, the baseline commit contains only a verified description of current behavior and direct traceability. Any intended correction or new behavior starts in a later OpenSpec change and lands separately. This gives reviewers a stable answer to two different questions: “did we recover what exists accurately?” and “is this the change we want?”

An aspirational baseline was rejected because it launders a behavior change into documentation. Combining baseline and modification in one commit was rejected because review cannot distinguish characterization mistakes from intentional deltas.

### Use OpenSpec strict validation plus the existing STC ratchet

CI will run strict validation for main specs and active changes after installing the pinned CLI, and will run the STC checker against `openspec/specs`. OpenSpec validation proves artifact structure; STC proves that declared slugs remain linked to code/tests subject to the existing baseline. Neither claims semantic agreement, which remains a review obligation.

The Journey-only evidence checker will no longer define the active spec root. Its useful failure-proofing principles remain in the review skills and history; current traceability converges on descriptive OpenSpec slugs.

### Refresh official workflow files and keep local review skills

The pinned CLI will generate the repository-supported OpenSpec workflow files for the agent locations this repository supports. Evaluation-era duplicates will be removed rather than hand-maintained. The local `code-review-8-axes`, `test-review-3-axes`, and `spec-review-5-axes` skills remain because they review semantic quality and STC agreement rather than duplicate CLI operations.

## Risks / Trade-offs

- **Legacy Journey documents can be mistaken for current authority during migration** → mark the directory and evaluation documents as superseded, freeze additions with a tested guard, and remove legacy files as each baseline is accepted.
- **Strict validation can be mistaken for behavioral proof** → keep that limitation explicit in guidance and run STC/review checks separately.
- **Generated files are verbose and version-sensitive** → pin exactly, refresh only during explicit upgrades, and review generated diffs rather than hand-editing them.
- **A guard based only on the current file list can hide indefinite migration debt** → name it as a migration baseline, prohibit additions, and let capability-by-capability baseline commits shrink it.

## Migration Plan

1. Commit this OpenSpec change's proposal, delta spec, design, and tasks before policy/tooling edits.
2. Pin the CLI, refresh supported workflow files, and add repository scripts.
3. Update contributor guidance, ADR, evaluation history, STC docs/tooling, CI, and the competing-spec guard.
4. Run strict validation, tooling tests, STC, documentation checks, and dry-run examples for both workflows.
5. Archive this completed change so `repository-change-workflow` becomes a main OpenSpec capability.

Rollback is a normal commit reverting the adoption implementation and archived capability; no deployed system or persisted user data is affected.
