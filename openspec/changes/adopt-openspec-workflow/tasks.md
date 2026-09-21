## 1. Reproducible OpenSpec installation

- [x] 1.1 Pin `@fission-ai/openspec` 1.13.0 in the root manifest and lockfile; verify `pnpm exec openspec --version` reports exactly 1.13.0.
- [x] 1.2 Add clear non-interactive strict validation scripts for main specs, active changes, and their combined repository gate; verify each script exits successfully on the repository.
- [x] 1.3 Refresh official OpenSpec workflow files from the pinned CLI for supported agent locations, remove stale duplicate surfaces, and verify generated metadata names version 1.13.0.

## 2. Mandatory workflow policy

- [x] 2.1 Update fresh-contributor guidance with the exact new-feature and existing-feature baseline-then-change workflows; verify the baseline-only commit prohibition and direct `@spec` traceability rule are stated once as current policy.
- [x] 2.2 Add the project-wide ADR for sole authority, baseline-first legacy recovery, delta changes, and explicit upgrades; verify operational commands remain in guidance/tooling rather than duplicated in the ADR.
- [x] 2.3 Supersede the OpenSpec-vs-Journey evaluation without deleting its dated evidence; verify its current ruling is unmistakable and its old recommendation is historical only.

## 3. Enforced single specification root

- [x] 3.1 Update STC and evidence documentation/tooling so only OpenSpec capability and active-delta specs are scanned as current behavior specifications; verify no active-tool description calls OpenSpec an example or mirror.
- [x] 3.2 Add a focused, mutation-tested guard that rejects additions to `docs/specs` while allowing design, ADR, research, and archived documents; verify both rejection and allowed-document cases.
- [x] 3.3 Add strict OpenSpec, STC, and competing-root validation to the normal CI path after dependency installation; verify the workflow calls repository scripts rather than a global CLI.

## 4. Migration proof and close-out

- [x] 4.1 Demonstrate the new-feature and legacy baseline-then-change paths in throwaway directories with the pinned CLI; verify strict validation passes and remove the temporary artifacts.
- [x] 4.2 Run focused tooling tests, all OpenSpec validation scripts, STC/evidence checks, available documentation/link checks, and `git diff --check`; record exact outcomes.
- [ ] 4.3 Mark all tasks complete, archive the change into the main capability tree, validate the archive, and leave a clean worktree with reviewable local commits.
