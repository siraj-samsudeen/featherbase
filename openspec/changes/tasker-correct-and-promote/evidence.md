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
| All retained references prevent deletion | Initial host omitted File/Share soft links | Generic follow-up 3760a7d integrated as fbc5f89; consumer includes files/shares | Red attachment-only deletion became green: File-only and Share-only refuse delete, prompt on promotion, preserve source and links |
| Real-commit proof respects custom Table placement | Upstream assertion queried actionproof_ref without its site schema after convergence | Use tableRelation('ActionProof Ref') in the assertion | Both writer/deletion race orders pass, including File/Share; no product change |
| Advertised core fields and attachments work after upgrade | Generic client omitted runtime identity and got 409 | 2c0f1a8 pins the generic page's identities; 703af3a exempts public credential exchanges | Real core Save/upload/download/remove; retained v1 tab refuses Save/upload with 403 pending and 409 activated |
| Sign-in preserves a shared task link | Root-only return dropped query and task hash; slashless normalization also lost query | 657b440 preserves safe login return; dfac711 preserves slashless query | Canonical and slashless signed-out browser journeys return exact encoded/repeated query and selected task |
| Core form remains usable at 375px | Nonwrapping heading/actions induced horizontal focus scrolling; Remove depended on hover | 95db87c generic responsive form/attachment correction | Direct 375 and 1440→375 bounds; retained errors/drafts; keyboard and independently tested touch Remove |

## Executed checks

- Latest combined full server: 853 passed, 17 skipped (15 MySQL plus two opt-in real-commit tests run separately below).
- Latest combined full web: 164 passed. Shared: 129 passed. Generic responsive browser tests: 2 passed, including held Uploading/disabled state and drawer readiness.
- Final retention integration: Tasker actions 8 and raw runtime deletion 2 passed. Earlier final convergence edge check: Query Report 6 and platform schema 4 passed.
- Tasker build and server/web typechecks passed. Strict OpenSpec 1.13.0, policy and STC passed. These are linkage/structure evidence, not a substitute for behavior tests.
- Real-commit `tasker-upgrade-action-commit.test.ts`: admitted promotion holds lifecycle lock through a blocked postcommit effect; queued upgrade, obsolete replay and disable wait. Pending activation rejects replay; old version conflicts after activation; current replay returns the single committed result without a second effect. Activation preserves disabled state.
- Real-commit `runtime-actions-commit.test.ts`: both delete-first and four-writer-first orders (Comment/Reference/File/Share), independently visible receipt in postcommit effects and replay after effect failure pass. Both opt-in tests pass together in the worker-owned DB.
- Literal package proof `dist/runtime-proof-idxjgs` at fbc5f89: frozen core, separately built npm tarball, fresh 0094→0095→0096, Tasker desktop/mobile matrix, eight identical concurrent generic actions, lost response/reload/replay, process restart, missing code/restore, preserved v1→actual v2, stale-browser rejection and rendered upgraded Project Markdown. File/Share counts survive real process restart replay; failed delete rolls back its receipt.
- One shell chain initially scoped DATABASE_URL only to the server command. The web setup refused the default database's duplicate ledgers before running tests. Rerun exported the worker-owned database for the entire chain: web/shared/types/specs/SQL lint all pass. No reset or repair of the default database was attempted.

Reproduce with private database URLs, never the shared `featherbase_test`:

```sh
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/featherbase_tasker296_integrated_e2e pnpm --filter server test
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/featherbase_tasker296_integrated_e2e pnpm --filter web test
RUNTIME_ACTION_COMMIT_PROOF=1 TASKER_UPGRADE_ACTION_PROOF=1 DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/featherbase_tasker296_actions_commit_e2e FEATHERBASE_ENV=test pnpm --filter server test test/runtime-actions-commit.test.ts test/tasker-upgrade-action-commit.test.ts
RUNTIME_PROOF_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/featherbase_tasker296_e2e RUNTIME_PROOF_PORT=8497 pnpm apps:prove
```

Direct local server identity was checked: Homebrew PostgreSQL 17.9, listener PID 2048, server address 127.0.0.1:5432. Only worker-owned disposable databases were reset. Do not reuse an old database whose ledger recorded action migration 0094; reset its disposable copy first.

## Visual equivalence classes actually inspected

`dist/runtime-proof-45YLVY` contains inspected desktop/375px Inbox, My Work, Together, Personal tasks, Projects landing, project description/editor, Compact/Inspector/Focus blank and populated, stale drafts, task editor, missing task, Take detail/My Work, Blocked/Done, overflow, promotion confirmation, deletion confirmation/refusal, deleted My Work, simple promoted project and upgraded Markdown project. `disabled.png` and `unavailable.png` were also inspected.

Final `dist/runtime-proof-XZJV4i` adds inspected blank-project Add states, loading and access-denied detail, and re-inspected representative Focus, Inspector, open overflow, desktop/mobile rich confirmation, mobile deletion confirmation/refusal and upgraded project Markdown. Its 45-class JSON records executed assertions; visual inspection is this separate record, not an automatic screenshot-pass claim.

After File/Share integration, `dist/runtime-proof-idxjgs` reruns all 45 classes. Its changed mobile delete confirmation/refusal were inspected: attachments/shared access appear, Cancelled is distinct from permanent deletion, and both fit at 375px. Desktop Focus empty was reinspected: calm description, Edit task, workflow and overflow visible, no textarea/Save until editing. Edit task opens both title and description; the title itself is not an inline-edit control.

Intentional horizontal scrolling is confined to the project strip and Markdown code blocks; every capture asserts no page-level horizontal overflow. Native select labels may truncate. A refusal leaves the existing state unchanged and directs the user to choose Cancelled; it does not silently cancel work. Administrator is the authenticated user in the packaged Take journey; the separate component journey uses an ordinary member.

Real read-back example:

| row_id | task_state | assigned_to | project | personal_tasks_owner |
|---|---|---|---|---|
| TASK-00001 | Not started | Administrator | null | null |

## Review outcome and remaining gates

Eight-axis review found two concrete integration assumptions (unregistered ledger relation and digest-pinned module identity) and the missing-task keyboard trap. Three-axis test review replaced implicit display-mode assumptions with output/persistence checks and added independent soft-link retention cases. No file/function-size findings or cosmetic refactors were added.

Five-axis divergence resolved: the requirement protects retained references, while the earlier generic guard protected only Comment/Version/declared References. The failing attachment-only regression proved the gap. Parent approved the generic File/Share guard and target locks, now integrated and proven; upstream archive a7f77f3 is included. Upload rejection may leave unlinked storage bytes, but not a File document pointing at a deleted runtime row. Arbitrary application pointers/direct admin SQL remain outside the contract.

Keep this OpenSpec change open for owner exploration under parent coordination. Guided Inbox processing and the pre-existing evidence gaps listed in `openspec/TASKER.md` are not claimed complete by this change. No live Dev deployment or authenticated deployed-commit smoke is claimed.

## Initial independent review: release blocked

Independent review of b97b1ab rejected release despite reproducing all passing counts above. Two boundary journeys were missing from the original matrix:

- The advertised advanced-fields/attachments link opens a core client without runtime identity, so upgraded Tasker rows return 409. The upgrades owner is correcting the generic pinned client, without weakening the host guard. The extended package proof retains a v1 core form across upgrade (Save/upload must refuse), then follows the actual Tasker link to v2 and exercises Save/upload/read/remove.
- Signed-out links lost the query and selected-task hash. The convergence owner is correcting generic safe login return. The new literal exact-URL assertion is red on the old core (`dist/runtime-proof-HWaLhf`), matching the independent finding. It will also assert the selected task is open after login.

The proof-isolation issue was separately closed by independent review of 8733964. Both opt-in real-commit tests pass unchanged on a reviewer-selected `featherbase_review296_873_actions_commit_e2e`; missing DATABASE_URL and shared `featherbase_test` are rejected during config loading, before database imports/global setup. The actual database name and test stamp are still asserted. At that checkpoint product findings remained open; no acceptance was inferred from the isolated proof correction.

## Integrated re-review and spec synchronization

Independent re-review closed all behavior findings, including public OAuth/reset with an expired saved bearer, exact login return, and actual touch-enabled attachment removal at 375px (File count zero and download 404). It gave conditional pass solely for the obsolete canonical layout requirement still visible to STC. The normal responsive archive d127c26, integrated as cc8b3f7, removes that requirement and makes the accepted responsive contract canonical. No checker changes, fake markers or baseline relaxation were used. **Correction:** the responsive owner's earlier prearchive combined STC result was red, not green; a later successful shell command had masked its exit status. This branch also observed and reported the red result before synchronization.

The unchanged 347f7f0 harness first passed the responsive correction at `dist/runtime-proof-eyOqzU`. Its immediate resize screenshot captured the existing sidebar animation, not a persistent drawer defect. 589883e adds a polled `sidebar.right <= 0` readiness assertion without clicking, hiding or weakening bounds, and adds repeated query parameters. The resulting `dist/runtime-proof-ne4Bia` proof passed and its settled mobile form was inspected. 0719045 adds a separate attachment-panel capture after native vertical scroll, because the main scroll container's lower content is not included in a viewport screenshot. Final exact-tip proof paths and commit identities are emitted in each run's JSON and reported to the parent.

The following generated core captures were individually inspected at 375 and 1440: blank, stale, validation, pending403, obsolete409, long attachment with keyboard focus, plus the resized-375 state (`dist/core-responsive-*.png`). Horizontal clipping is fixed; ordinary vertical scrolling remains intentional. Refusal presentation probes use injected 403/409 responses; actual lifecycle admission is independently exercised by the retained-v1 package journey. No injected response is offered as proof of host authorization.

Independent reports and preserved evidence are under the parent workspace's `outputs/review296-b97-independent`, `outputs/review296-identity-independent` and `outputs/review296-final-independent`. Final independent delta review at clean cc8b3f7 issued **PASS for Dev test deployment**, independently reran `check:specs` with exit 0 and confirmed shipped behavior byte-identical to browser-proved 95db87c. This is review acceptance, not deployment authorization or production acceptance. Owner exploration and exact-deployed-commit smoke remain parent-owned. Keep Tasker's change active; no deployment or live Dev smoke is claimed.
