# Tasks

## 1. Establish the database invariant

- [x] 1.1 Load the TDD skill, boot and smoke-test the unchanged app on a positively identified disposable local database, and record the runnable commands before implementation.
- [x] 1.2 Add a failing real-Postgres proof for direct duplicate active writes and migration refusal on existing duplicates, then install the partial unique index in the next migration; verify inactive alternatives remain allowed and failed migration leaves duplicate rows unchanged.

## 2. Make conflicting saves explicit

- [x] 2.1 Add failing sandboxed HTTP tests for a competing active insert, activating an inactive alternative, and retargeting an active workflow; implement scoped conflict translation and verify each refusal names the existing workflow and leaves persisted data unchanged.
- [x] 2.2 Verify first activation, editing the same active workflow, multiple inactive alternatives, explicit deactivate-then-activate switching, and different Tables with focused HTTP tests; keep existing single-workflow execution tests passing.
- [x] 2.3 Remove newest-edit selection and add a failing-then-passing lookup test that refuses duplicate active results in an intentionally broken local schema while preserving normal lookup and bootstrap behavior.

## 3. Prove concurrency and integrate

- [x] 3.1 Add and run an opt-in committed concurrency test on a dedicated directly local test-stamped database: observe actual transaction overlap/lock wait, release the first writer, assert only one activation commits and the loser names the winner, and read final durable state independently. Document the exact command beside the proof.
- [x] 3.2 Run the workflow suites, committed proof, server typecheck, strict OpenSpec validation, and smoke checks; use feather-code-review (including its codebase-design guidance) and resolve scoped findings with rerun evidence.
- [x] 3.3 Record verified commands and remaining caveats in PROGRESS.md, commit the scoped implementation, push the branch and open a PR for independent parent review; report the exact head and runnable verification without merging.
