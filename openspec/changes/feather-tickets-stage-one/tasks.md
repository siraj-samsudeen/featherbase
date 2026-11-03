# Feather Tickets implementation tasks

The existing JavaScript acceptance runner extracts fenced scenarios; do not
scaffold a second runner. Use the effective suite including this change, not
only the main-spec profile. Reuse existing setup/auth/document steps where
appropriate. Each new pending business step below follows: demonstrate the
correct red → implement through the public runtime → green → commit. Add
step-level tasks here if extraction reveals another required pending step;
never conceal pending steps or batch failing scenarios into a claimed pass.

## 1. Acceptance setup

- [x] 1.1 Preserve the specifications in their own commit or stash before crossing into the code zone; retain this change's own worktree and branch.
- [x] 1.2 Configure an isolated instance/database and distinct API/web ports from `.env.example`; keep secrets untracked. Boot it with `./init.sh` and the existing supervised-service workflow.
- [x] 1.3 Extract the effective acceptance scenarios, confirm parsing and report generation, and inventory reusable versus pending steps. Establish that new scenarios fail or are pending before writing Tickets source.
- [x] 1.4 Extend existing app-installation acceptance fixtures for a separately chosen Tickets package, an app-free baseline and a second configuration. Drive the missing-package failure before adding the minimal manifest, package build and host entries.
- [x] 1.5 Reproduce generic rename and current-revision history deletion bypasses through real HTTP; add owned-table destructive guards and prove stable references and retained evidence, including Administrator attempts.

## 2. Intake and triage — pending business steps

- [x] 2.1 Free-text submission returns a durable ticket reference — red → implement manifest-owned storage/runtime action and intake UI → green → commit.
- [x] 2.2 Saved requests survive sign-out and sign-in — red → implement authenticated requester reads → green → commit.
- [x] 2.3 Structured access retains the recipient/scope without verifying employment — red → implement access intake → green → commit.
- [x] 2.4 Report intake retains location, exact period and format — red → implement report intake → green → commit.
- [x] 2.5 Other warehouse categories retain their relevant request details — red → implement investigation, source, column/model, pipeline and backfill intake → green → commit.
- [x] 2.6 Classification retains the immutable original — red → implement authorized triage and original-message validation, including ordinary-write attempts → green → commit.
- [x] 2.7 A full displayed reference finds its ticket — red → implement reference/word search → green → commit.
- [x] 2.8 Assigned open work excludes unrelated requests — red → implement assignment and status/category/responsibility filtering → green → commit.
- [x] 2.9 A requester sees public progress without private support content — red → implement separate private records and explicit permissions; test generic list/detail/activity/export as well as runtime reads → green → commit.
- [x] 2.10 Another requester can find shared summaries/public progress without private request or employee detail — red → implement shared public reads, preserving private-detail access controls across counts/search/detail/activity/export → green → commit.
- [x] 2.11 Shared visibility does not permit editing others' requests or making support decisions — red → enforce independent write/action authorization through app and ordinary APIs → green → commit.

## 3. Access — pending business steps

- [x] 3.1 An authorized verifier records exact identity, active employment, region and attributed evidence — red → implement configurable verification membership and action → green → commit.
- [x] 3.2 Unverified and inactive requests cannot advance — red → implement guards for approval and fulfillment, including direct generic writes → green → commit.
- [x] 3.3 An ordinary requester cannot verify employment — red → enforce verifier authority and server-supplied actor/time → green → commit.
- [x] 3.4 The configured regional approver can approve or reject the current request — red → implement route configuration and decision history → green → commit.
- [x] 3.5 Either configured Chennai approver is sufficient — red → implement alternative rather than unanimous approval → green → commit.
- [x] 3.6 A stale conflicting decision cannot replace a recorded one — red → exercise overlapping real HTTP actions and host idempotency/revision checks → green → commit.
- [x] 3.7 Only a fulfillment admin records completion of the current approved scope — red → implement manual fulfillment reference and attributed resolution; test an approver without that membership → green → commit.
- [x] 3.8 Recipient/employment/region/scope changes invalidate their dependent gates — red → implement invalidation and preserve prior events; prove that ordinary writes cannot retain stale approval → green → commit.
- [x] 3.9 A restricted resource cannot gain ordinary approval — red → implement configured policy-review gate with missing configuration failing closed → green → commit.

## 4. Investigation — pending business steps

- [x] 4.1 A complaint without evidence remains unconfirmed — red → implement explicit manual investigation state and honest unconfigured-integration presentation → green → commit.
- [x] 4.2 A supported mismatch can be recorded without inventing a root cause — red → implement expected/observed outcomes and attributed evidence references/observation times → green → commit.
- [x] 4.3 Related issue/PR references remain links rather than claimed agent execution — red → implement safe related-work entry → green → commit.
- [x] 4.4 Reopening retains earlier resolution and evidence — red → implement reasoned non-access resolution/reopening with immutable attributed history → green → commit.
- [x] 4.5 Ordinary resolution cannot bypass access fulfillment — red → enforce the access-specific terminal gate across app and generic writes → green → commit.
- [x] 4.6 A supported non-access resolution persists its reason and evidence — red → implement resolution recording and retrieval → green → commit.
- [x] 4.7 Connection inspection shows unconfigured integrations without invented live activity — red → implement connection status → green → commit.
- [x] 4.8 An ordinary installation contains no sample requests — red → keep sample setup out of normal installation → green → commit.
- [x] 4.9 Explicit development sample loading creates clearly fictional evidence — red → implement opt-in development seed and labels → green → commit.

## 5. Completion

- [x] 5.1 Run the full effective acceptance suite: all scenarios pass, zero pending/undefined steps and HTML report generated. Run targeted backend checks, typecheck, app build and `pnpm check:platform-imports`; do not weaken existing coverage gates or exclusions.
- [x] 5.2 Prove explicit installation, unconfigured fail-closed behavior and different instance membership/routing. Keep real people and credentials out of fixtures; provide opt-in fictional development data only.
- [x] 5.3 Verify the desktop UI against issue #810's numbered checklist with an independent headless verifier at 1280px. Exercise requester, triager, verifier, approver and fulfillment identities, empty/error states and reload persistence. Capture and inspect screenshots and interaction recordings.
- [x] 5.4 Offer an optional adversarial review because access permissions and identity decisions are sensitive; run only with owner consent. Use the repository code-review route for hidden server/data logic, triage findings and rerun affected checks.
- [x] 5.5 Run `pnpm exec openspec validate feather-tickets-stage-one --strict --no-interactive`, rerun `./init.sh`, and present the runnable installed-app preview and final walkthrough evidence for owner review.
- [ ] 5.6 After owner review and authorization for delivery, sync specifications and archive on this same change branch; keep code/spec zones separate. Prepare the PR with reproducible checks and usage instructions; do not merge, deploy or write to production without explicit approval.
