## 1. Acceptance first

- [x] 1.1 Step definitions for "A role is picked from the roles that exist" and "A typed role that was never picked is not saved" on the Person form: fail for the right reason (the role cell is a plain text box)

## 2. Implementation

- [x] 2.1 A Reference column in the nested-row grid renders the form's link picker, keeping the cell's accessible name and identity; component tests pin offering, picking, and that typed-but-unpicked text is not saved
- [x] 2.2 The picker's options are not clipped by the grid's scrolling frame

## 3. Completion

- [x] 3.1 Focused web and browser tests, typecheck, strict OpenSpec validation, full effective acceptance with no pending steps, boot smoke
- [x] 3.2 Independent headless check at 1280px against the issue's "Done when"
- [x] 3.3 Sync the delta into the main spec and archive the change

Full effective acceptance passed 152 scenarios and 1927 steps, none pending or skipped (at 2beb774; the two
new scenarios passed again after the review fix). Focused component checks (nested-links, core-forms,
form-labels, form-extras: 31 tests) and browser checks (nested-link-picker, grid-layout, formview: 8 tests)
passed; web typecheck, strict OpenSpec validation and the e2e DSL guard passed. One ordinary review round by
a different Claude model: no level 1; level 2 findings fixed in 6d74f9d (stale cell errors, unpicked text
left in a grid cell, a late search reopening the list, the floating list drifting on scroll). An independent
headless verifier at 1280px passed all five checklist items on #832.
