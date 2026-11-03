## 1. Acceptance-first examples

- [x] 1.1 Author executable steps for the Table-address scenarios and demonstrate the spaced-name navigation failure on unchanged code.
- [x] 1.2 Demonstrate the reserved Table/row collision failures; retain query and canonical-name controls.
- [x] 1.3 Demonstrate public collision refusals red through creation/import/reflection and real app install/upgrade, with noncolliding and own-identity controls.

## 2. Implementation

- [x] 2.1 Share Table normalization and URL generation; implement explicit Table/row/new/tool routes and metadata-based canonical resolution.
- [x] 2.2 Migrate canonical consumers, internal links, notifications, recents and shipped app anchors without changing row IDs, filters, prefill or labels.
- [x] 2.3 Migrate existing test navigation and page objects, preserving their behavioral assertions.
- [x] 2.4 Enforce new cross-Table slug uniqueness at shared mutation boundaries without changing existing identities, permission checks or ambiguity refusal.

## 3. Verification and handoff

- [x] 3.1 Run the effective acceptance suite with zero pending/undefined steps and its HTML report; verify real HTTP and browser routes, including ambiguity and settings.
- [x] 3.2 Run targeted regression suites, typechecks/build, strict OpenSpec validation and ordinary code review; fix relevant findings.
- [x] 3.3 Record review evidence and prepare the tested PR with exact-head CI/comment subscriptions. Do not merge, deploy or archive before the owner's remaining gates.

Finalization authority: on 2026-11-03 the manager relayed the owner's explicit instruction, “if CI is green, you should take over, fix any conflicts and merge. period.” The manager directed spec sync/archive and final-head validation on this branch, followed by independent verification and a merge commit in the manager session. This supersedes the routine finalization wait; it does not assert the owner watched review videos, waive the three-round review ceiling, or authorize production writes or manual deployment. See the [working thread](https://ampcode.com/threads/T-01a19fe5-6fe1-756b-88fa-692bc956d09f).
