## 1. Acceptance steps

- [x] 1.1 Implement disposable history fixtures and acceptance steps for replacement after reload; demonstrate failure on unchanged code.
- [x] 1.2 Implement acceptance steps for loading suppression, failure fallback and a visit during loading; demonstrate failures before fixing.

## 2. Client reconciliation — test first

- [x] 2.1 Add a failing empty-summary unit regression, then replace cached history with the authoritative summary and rename the reconciliation function.
- [x] 2.2 Add regression coverage for queued, in-flight, failed/retried flushes and a summary captured before flush completion; preserve only local visits not covered by the summary.
- [x] 2.3 Add a shell regression for initial loading and failure fallback; gate sidebar and command-bar history until the initial summary settles and trigger a render on settlement.

## 3. Completion

- [x] 3.1 Run targeted and full relevant web checks, typecheck, strict OpenSpec validation and real-server disposable reload/history checks.
- [x] 3.2 Record and inspect screenshots and an interaction clip; obtain independent headless UI verification at 1280px against #769's checklist.
- [x] 3.3 Commit, push, prepare the PR and subscribe to exact-head CI and PR comments; report evidence to the manager.
- [x] 3.4 Under the owner's recommended-default authorization relayed by the manager, sync and archive on this branch before merge. Manager-reviewed media is preserved; this does not claim the owner watched specific frames. Optional design.md remains omitted as documented in adr.md.
