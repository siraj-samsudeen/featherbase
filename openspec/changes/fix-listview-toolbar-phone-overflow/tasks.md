# Tasks

## 1. Responsive ListView toolbar

- [x] 1.1 Add a failing metadata-rich ListView browser regression at 375px and desktop width that uses Session DSL operations where supported, asserts every header action is present and horizontally reachable, proves the Admin main does not overflow, and separately proves the rows table owns legitimate inner overflow; run it to confirm the current phone failure.
- [x] 1.2 Adjust only the existing ListView header and toolbar `.fc`/responsive utility classes to stack and wrap at narrow widths while retaining desktop alignment and all current action gates and behavior; verify the focused browser regression passes without changing dependencies or bulk-delete behavior.
- [x] 1.3 Capture and inspect representative 375px and desktop screenshots from the metadata-rich regression, verifying readable wrapping, complete reachable controls, and unchanged desktop composition.

## 2. Integration and delivery

- [x] 2.1 Run the focused ListView browser suite, web typecheck, strict OpenSpec validation, Session DSL guard, and `git diff --check`; append the verified result and next step to `PROGRESS.md`.
- [x] 2.2 Run the Feather code review workflow, resolve all in-scope findings, rerun affected checks, then commit, push, and open a PR with the exact head and verification evidence for independent parent review.
