# Tasker correction acceptance evidence

Local proof only. No push, PR, merge, deployment, Railway change or shared data write.
Parent owns independent exploration and authenticated exact-deployed-commit smoke.

## Expected → observed → correction → recheck

| Expected | Observed defect or tested competing interpretation | Correction | Passing recheck |
|---|---|---|---|
| Correct title and description intentionally | Original detail lacked title correction; blank description opened a large editor immediately | c59df6d explicit read/edit/Save/Cancel and draft-start revision | Component correction/cancel/conflict tests; three modes × blank/populated × desktop/375px |
| Focus is a working surface | Workflow controls missing from the owner's reported Focus screen | c59df6d shared state/responsibility/destination/urgency/completion controls | Persisted state loop, Take readback, inspected Focus and Inspector |
| Take changes responsibility and My Work | Reported membership failure was not reproduced; task title alone cannot diagnose it | No speculative predicate fix; asymmetric regression added | Ordinary-member Blocked+urgent Inbox task keeps state/urgency/destination and enters My Work once, not Personal |
| Retain comments/history when promoting | Personal departure hook clears implied responsibility | 31e7804 rich action retains ID and restores responsibility within the same host transaction | Independent rich-signal tests and Personal promotion test |
| Retry a committed action after losing its response | Simple source disappears before browser can retry | 31e7804 durable per-caller/task request envelope | Browser intercept commits then aborts response; reload and same-key retry produces one project |
| Package upgrades and actions compose | Fresh 0096 ledger existed in featherbase but was absent from SQL relation registry | Convergence 17cc06a integrated as 9c8b420 | Tasker actions + raw DELETE tests; private-schema/ACL readback |
| Keyboard stays in unavailable Focus | Closed overflow buttons were incorrectly counted as tab endpoints | e3e5b8f visible focusables include summary | Tab and Shift+Tab wrap between Close and More actions on a missing task |
| Proof captures the selected mode | Initial screenshot labels could precede persisted mode completion | Explicit aria-pressed + preference readback before captures; 42f7c3b selects legacy Inspector proof explicitly | Browser assertions and inspected selected-mode controls |
| All retained references prevent deletion | Initial host omitted File/Share soft links | Generic follow-up contract cc1ee2e; consumer includes files/shares | Red regression observed deleted:true for attachment-only task; integration/green recheck pending |

## Executed checks

- Full server: 850 passed, 17 skipped (15 MySQL plus two opt-in real-commit tests).
- Full web: 155 passed. Shared: 129 passed.
- After final convergence edge commit: Tasker actions 7, Query Report 6 and platform schema 4 passed.
- Tasker build and server/web typechecks passed. Strict OpenSpec 1.13.0, policy and STC passed. These are linkage/structure evidence, not a substitute for behavior tests.
- Real-commit `tasker-upgrade-action-commit.test.ts`: admitted promotion holds lifecycle lock through a blocked postcommit effect; queued upgrade, obsolete replay and disable wait. Pending activation rejects replay; old version conflicts after activation; current replay returns the single committed result without a second effect. Activation preserves disabled state.
- Literal package proof `dist/runtime-proof-XZJV4i`: frozen core, separately built npm tarball, fresh 0094→0095→0096, Tasker desktop/mobile matrix, eight identical concurrent generic actions, lost response/reload/replay, process restart, missing code/restore, preserved v1→actual v2, stale-browser rejection and rendered upgraded Project Markdown.

Reproduce with private database URLs, never the shared `featherbase_test`:

```sh
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/featherbase_tasker296_integrated_e2e pnpm --filter server test
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/featherbase_tasker296_integrated_e2e pnpm --filter web test
TASKER_UPGRADE_ACTION_PROOF=1 DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/featherbase_tasker296_actions_commit_e2e FEATHERBASE_ENV=test pnpm --filter server test test/tasker-upgrade-action-commit.test.ts
RUNTIME_PROOF_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/featherbase_tasker296_e2e RUNTIME_PROOF_PORT=8497 pnpm apps:prove
```

Direct local server identity was checked: Homebrew PostgreSQL 17.9, listener PID 2048, server address 127.0.0.1:5432. Only worker-owned disposable databases were reset. Do not reuse an old database whose ledger recorded action migration 0094; reset its disposable copy first.

## Visual equivalence classes actually inspected

`dist/runtime-proof-45YLVY` contains inspected desktop/375px Inbox, My Work, Together, Personal tasks, Projects landing, project description/editor, Compact/Inspector/Focus blank and populated, stale drafts, task editor, missing task, Take detail/My Work, Blocked/Done, overflow, promotion confirmation, deletion confirmation/refusal, deleted My Work, simple promoted project and upgraded Markdown project. `disabled.png` and `unavailable.png` were also inspected.

Final `dist/runtime-proof-XZJV4i` adds inspected blank-project Add states, loading and access-denied detail, and re-inspected representative Focus, Inspector, open overflow, desktop/mobile rich confirmation, mobile deletion confirmation/refusal and upgraded project Markdown. Its 45-class JSON records executed assertions; visual inspection is this separate record, not an automatic screenshot-pass claim.

Intentional horizontal scrolling is confined to the project strip and Markdown code blocks; every capture asserts no page-level horizontal overflow. Native select labels may truncate. A refusal leaves the existing state unchanged and directs the user to choose Cancelled; it does not silently cancel work. Administrator is the authenticated user in the packaged Take journey; the separate component journey uses an ordinary member.

Real read-back example:

| row_id | task_state | assigned_to | project | personal_tasks_owner |
|---|---|---|---|---|
| TASK-00001 | Not started | Administrator | null | null |

## Review outcome and remaining gates

Eight-axis review found two concrete integration assumptions (unregistered ledger relation and digest-pinned module identity) and the missing-task keyboard trap. Three-axis test review replaced implicit display-mode assumptions with output/persistence checks and added independent soft-link retention cases. No file/function-size findings or cosmetic refactors were added.

Five-axis divergence: the requirement protects retained references, while the earlier generic guard protected only Comment/Version/declared References. The failing attachment-only regression proves the gap. Recommendation: extend the generic guard and its target locks to File/Share; if rejected, hard deletion/simple-source removal must remain blocked for those links rather than weakening the promise. Parent has coordinated the generic follow-up.

Keep this OpenSpec change open until that integration and parent independent exploration pass. Guided Inbox processing and the pre-existing evidence gaps listed in `openspec/TASKER.md` are not claimed complete by this change.
