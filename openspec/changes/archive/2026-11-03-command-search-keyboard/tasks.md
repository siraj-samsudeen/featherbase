## 1. Acceptance first

- [x] 1.1 Reproduce missing typed-result selection through public keyboard interaction and pin it with a failing regression.
- [x] 1.2 Reproduce or disprove prior-query activation during realistic debounce replacement; execute the fenced scenarios through acceptance steps.

## 2. Implementation

- [x] 2.1 Add visible accessible plain-arrow selection and Enter activation across displayed results without duplicating destination logic; preserve recents, replay, Escape, reopening, modified arrows and #824 dismissal.
- [x] 2.2 Prevent stale prior-query record activation if reproduced.

## 3. Completion

- [x] 3.1 Run focused component/browser checks, typecheck, strict OpenSpec validation and boot smoke.
- [x] 3.2 Independently verify the issue checklist headlessly at 1280px and inspect keyboard/pointer recording and screenshots.
- [x] 3.3 Prepare PR with exact-head CI/comment subscriptions and report remaining manager-owned archive/merge gates. No self-merge or manual deployment.

PR: https://github.com/siraj-samsudeen/featherbase/pull/836. Full effective acceptance passed 65 scenarios and 456 steps, with no pending/skipped steps, after fixing readiness in the new page-object setup. Component checks passed 38 tests; browser checks passed 17 tests; typecheck, strict validation, DSL guard and fresh boot smoke passed. An independent headless 1280px verifier passed the exercised checklist. Record activation is supported by the public browser test, the fenced acceptance scenario and the independent verifier; the short clip is not the sole proof.

The manager downloaded/inspected the clip and selected-table screenshot, and conveyed authorization to sync/archive under the owner's standing small-fix delivery/defaults approval. This does not claim Siraj watched particular frames. Specs are synced and archived on this PR branch. Exact-final-head CI remains a merge gate; merge is manager-owned. No self-merge or manual deployment was performed.
