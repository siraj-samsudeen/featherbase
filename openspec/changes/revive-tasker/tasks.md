## 1. Decisions and baseline

- [ ] 1.1 Use domain-modeling to append an ADR superseding ADR 0013's Tasker retirement consequence; verify it links #563 and preserves the historical ADR.
- [ ] 1.2 Boot with ./init.sh and run pnpm smoke; record the commands and repair baseline failures before feature work.
- [ ] 1.3 Agree the screen design with the owner and record a numbered UI checklist in #563 covering labels, icons, order, formats, states and phone width; verify explicit owner acceptance before UI implementation.
- [ ] 1.4 Resolve the required app membership/grant and shared design exports using codebase-design and #617; verify the documented interfaces require no Tasker-specific platform branches.

## 2. Membership and data safety

- [ ] 2.1 Use tdd to enforce explicit membership across catalog, direct reads/writes and app actions; prove member, non-member and same-session revocation cases with real server integration tests.
- [ ] 2.2 Remove legacy broad grants through a new migration and versioned app release; prove fresh and upgraded local databases retain work and have no unintended All grants on platform tables.
- [ ] 2.3 Verify comments/history and supporting people choices under ordinary membership; use real integration tests to prove permitted collaboration without exposing unrelated platform records.
- [ ] 2.4 Prove private Focus, project stars and saved views remain private while personal tasks remain shared; run the relevant Tasker behaviour tests.

## 3. Existing behaviour and presentation

- [ ] 3.1 Fix collection truncation using tdd, including tasks beyond 500 and supporting lists; turn #508's failing pin into a normal test and prove the newly captured task is visible.
- [ ] 3.2 Resolve activity authors to names and use agreed date/time formatting; turn #547's pin into a normal test and prove formatting with an ordinary member.
- [ ] 3.3 Implement the approved UI checklist using shared Shop Floor exports; verify design guards include Tasker and pass for both themes.
- [ ] 3.4 Repair shared-bar scrolling and phone inspector positioning; turn the existing phone overlap pin into a passing browser test.

## 4. Verification and trial

- [ ] 4.1 Run relevant server, web and Tasker tests/typechecks and a browser capture → organise → assign → comment → complete journey; record exact commands and results in #563 and the PR.
- [ ] 4.2 Have an independent verifier use Playwright at 1280px and 375px in light/dark against the approved UI checklist; deliver screenshots and a spec-versus-built table, fix differences and rerun verification.
- [ ] 4.3 Run feather-code-review for hidden access, migration and server logic, at most two Codex rounds; record blocker resolution and separately track remaining findings.
- [ ] 4.4 Prove new app identity and data-preserving upgrade on the relevant local install paths; record reproducible release commands and retained-data checks.
- [ ] 4.5 Obtain owner screenshot acceptance, select trial members and instance, and follow docs/DEPLOY.md for the rollout; verify the exact deployed commit with ordinary members and record the handoff.
- [ ] 4.6 Reconcile the owner-exploration task in tasker-correct-and-promote without marking unverified work complete; archive this change only once all its required work is verified, then run pnpm check:specs.
