## 1. Acceptance examples — red before implementation

- [x] 1.1 Extend the existing import acceptance page/steps for identical and one-changed-population previews, including matching-mode wording; run extracted scenarios and record the expected red failures.
- [x] 1.2 Add correction preview examples for mixed change/retention, retained previous source without a new conflict, and no-history overwrite; demonstrate failures on unchanged main.
- [x] 1.3 Add explicit remembered/value-derived key acceptance and ambiguous-key examples; demonstrate the silent remembered-key activation/missing suggestion failures.
- [x] 1.4 Add full-overlap append refusal/explicit acknowledgement examples and typed-count boundary examples for 61 unchanged, 20 changed and 21 changed; run red before source edits.

## 2. Derived server facts — focused red/green cycles

- [x] 2.1 Extend existing import HTTP tests with asymmetric normalized value differences, retained-vs-conflict counts and row-overlap counts; minimally extend `planImport` and collection dry-run reporting. Preserve real import/no-op lifecycle, source observations and undo, and run those existing regressions.
- [x] 2.2 Test candidate-key coverage through public HTTP: remembered eligibility, full and partial overlap, blank/duplicate/ambiguous keys, unreadable columns and inaccessible rows. Implement the smallest server analysis using existing resolution and permission primitives without changing copy/transaction code.

## 3. Generic wizard — focused red/green cycles

- [x] 3.1 Extend import-run aggregation tests across more than 500 rows and grouped sheets; carry changed/unchanged, changed-value, retained-row/value and new-conflict facts into immediate preview and Check.
- [x] 3.2 Make the banner follow the active key, require explicit key-suggestion acceptance, retain the no-history/automation explanations and use honest matched/processed wording for existing completion/history counts.
- [x] 3.3 Use click-time changed counts for typed confirmation only above 20; test target/all-target scope and invalidation. Implement full-overlap append acknowledgement, alternate key acceptance and failed-analysis refusal without disabling intentional append.

## 4. Verification and delivery

- [x] 4.1 Run the effective acceptance suite with zero pending/undefined steps and HTML report; run targeted server/web regressions, typechecks, build and repository guards. Keep the isolated stack bootable with `./init.sh`.
- [x] 4.2 Record representative default/suggested/keyed/correction/append/typed-confirmation states, inspect screenshots and pointer clip, and run an independent headless UI verifier at 1280px against #851's numbered checklist.
- [ ] 4.3 Run the required ordinary server/permission review, triage findings, and verify fixes, with at most three rounds. No adversarial review without consent.
- [x] 4.4 Run `pnpm exec openspec validate honest-file-reimport --type change --strict`, publish the issue branch/PR and subscribe to exact-head CI plus PR comments. Report evidence and any failed gates to manager770; do not merge/deploy.
- [ ] 4.5 After required approval to finalize, sync/archive on this branch, rerun relevant acceptance/spec checks and exact-head CI, and hand off the final PR state. Do not claim the owner watched media without evidence.

## 5. Ordinary-review round 1 repair

- [x] 5.1 Pin independent readable-overlap and usable-key permission facts through public HTTP, including read/create-no-write, read-all/write-own and write-all/read-own controls; record expected red failures.
- [ ] 5.2 Add the executable read-only overlap acceptance example and actual plan-choice consent invalidation regressions; exercise the restricted HTTP boundary without broadening the System Manager-only wizard route.
- [ ] 5.3 Separate readable coverage from `can_match` eligibility on the server and through chunk aggregation; hide unusable matching-key actions while preserving full-overlap append warnings and analysis no-side-effects.
- [ ] 5.4 Rerun acceptance, relevant server/web tests and guards, publish the corrected pin and exact-head CI subscription, and send the bounded runtime delta for ordinary review round 2. Keep L3 trade-offs in the PR body only.
