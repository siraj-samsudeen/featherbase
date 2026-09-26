# Tasks

## 1. Project rename draft

- [x] 1.1 Load the diagnosing-bugs and tdd skills, boot the app and run the existing smoke flow before implementation; record the commands and outcomes.
- [x] 1.2 Add a real-server regression in `apps/web/test/task-management.test.tsx`: begin rename, save a competing name, trigger and witness a project refetch, submit, and assert conflict, preserved typed name, and persisted newer name. Run it before the fix and record the expected failure.
- [x] 1.3 Snapshot the project identity, name, and revision at rename start using the task draft pattern; preserve it across refetch/errors and reset on success, Cancel, or project navigation. Verify the regression passes and cover Cancel/reopen against the refreshed revision and switching projects without draft leakage.

## 2. Integrated verification and delivery

- [x] 2.1 Add and run a scoped Session DSL browser regression against the real installed Tasker package, proving the competing save and completed refetch precede submission, the conflict is visible, and HTTP readback retains the newer name.
- [x] 2.2 Run the full Tasker component test file, Tasker package tests/build/typecheck, web typecheck, strict OpenSpec validation, DSL guard, and `git diff --check`; record exact runnable commands and outcomes.
- [ ] 2.3 Run feather-code-review, resolve in-scope findings, and append verified evidence and remaining handoff to `PROGRESS.md`; commit the scoped implementation, push, and open a PR linked to #315 without merging. Report the exact head and runnable evidence to the parent.
