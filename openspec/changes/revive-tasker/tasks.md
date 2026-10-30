## 1. Baseline and implementation design

- [x] 1.1 Boot with ./init.sh and run pnpm smoke; record reproducible baseline commands before code changes.
- [x] 1.2 Use domain-modeling to append an ADR superseding Tasker's retirement; verify #563 is linked and historical ADRs remain intact.
- [ ] 1.3 Inspect installed Tasker versions and legacy task ownership; obtain a migration decision if creator and former personal owner differ or work was already shared, recording evidence without exposing private data.
- [ ] 1.4 Use codebase-design to specify the generic mandatory privacy seam and app-facing UI exports; prove the design covers administrative bypass and every relevant read/write surface, without Tasker-specific platform branches.
- [ ] 1.5 Resolve the remaining recurrence and parent-reopening decisions in design.md before those tasks; update their scenarios and verify owner decisions are recorded.

## 2. Privacy and access

- [ ] 2.1 Use tdd for explicit membership and immutable creator identity; prove member/non-member admission and same-session revocation through real server tests.
- [ ] 2.2 Implement mandatory creator-only privacy; prove other members, Administrator and System Manager cannot read or alter private work through direct requests, lists/counts, search, exports, references, shares, realtime, comments/history or files.
- [ ] 2.3 Implement private capture and one-way sharing with all dependent content; prove transaction rollback, direct-request enforcement and refusal to make shared work private again.
- [ ] 2.4 Remove obsolete broad grants using convergence migrations; prove fresh installs and existing databases retain data and private user settings.

## 3. Workspace and readiness fixes

- [ ] 3.1 Implement My Work as default while retaining deep links and private capture; verify component and browser navigation journeys.
- [x] 3.2 Fix collection truncation, including supporting lists; turn #508's pin into a normal passing test and verify newly captured tasks beyond 500.
- [x] 3.3 Resolve authors to names and adopt shared formatting; turn #547's pin into a normal test and prove an ordinary member's activity display.
- [ ] 3.4 Build the Attention first shell and detail layout from #563's checklist with Shop Floor exports; include Tasker in design guards and verify both themes.
- [ ] 3.5 Fix shared-bar and phone inspector positioning; turn the overlap pin into a passing browser test at 375px.

## 4. Subtasks and discussion

- [ ] 4.1 Use tdd to add one level of assignable subtasks with inherited privacy and individual status; prove direct requests cannot create deeper nesting or conflicting visibility.
- [ ] 4.2 Add explicit parent completion gating; prove open-child refusal, Done/Cancelled acceptance, no auto-completion and concurrent child-change safety.
- [ ] 4.3 Add task/subtask conversation roots and one-level replies; prove replies stay attached to the correct question and inherit access.
- [ ] 4.4 Add respondent selection, waiting/review/resolved states, asker-only resolution and reopening; prove unread state never resolves a question.
- [ ] 4.5 Populate Attention first from questions needing a reply/review; verify a browser journey answering a teammate and resolving one's own question, with no private-task leakage.

## 5. Recurrence

- [ ] 5.1 Add recurring definitions and independent task/subtask snapshots; prove new occurrences reset completion and retain prior history separately.
- [ ] 5.2 Implement fixed schedules with skipped missed slots and one active occurrence; prove Monday unfinished → Wednesday completion → next Monday, including concurrent worker retries.
- [ ] 5.3 Implement intervals after completion; prove next occurrence derives from actual completion time and cannot overlap current work.
- [ ] 5.4 Implement the approved calendar, cancellation, reopening and privacy rules; prove the agreed edge cases with real database tests and expose understandable scheduling controls.

## 6. Single-PR verification and trial

- [ ] 6.1 Run proportionate tests after each stable commit and the combined suites/typechecks at integration; record exact commands in the one Tasker PR.
- [ ] 6.2 Have an independent verifier run the numbered UI checklist at 1280px and 375px in light/dark; deliver screenshots and a spec-versus-built table, fix differences and rerun.
- [ ] 6.3 Run feather-code-review for hidden access, migration and scheduling logic, at most two Codex rounds; fix blockers and record remaining findings.
- [ ] 6.4 Prove the new app version's install, upgrade, fingerprints and retained data; do not modify an installed artifact under its old version.
- [ ] 6.5 Reconcile existing Tasker changes without marking unverified owner exploration complete; update main spec purpose text that still describes shared personal lists when the implementation lands.
- [ ] 6.6 After all implementation and verification, archive this completed change in the same single PR and run pnpm check:specs; retain the draft PR until owner screenshot acceptance.
- [ ] 6.7 Select trial members and instance and follow docs/DEPLOY.md; verify the exact deployed commit with ordinary members and record the handoff. Leave this task open until rollout is actually completed or explicitly moved to a tracked follow-up by the owner.
