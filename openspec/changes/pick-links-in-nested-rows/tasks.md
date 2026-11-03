## 1. Acceptance first

- [x] 1.1 Step definitions for "A role is picked from the roles that exist" and "A typed role that was never picked is not saved" on the Person form: fail for the right reason (the role cell is a plain text box)

## 2. Implementation

- [x] 2.1 A Reference column in the nested-row grid renders the form's link picker, keeping the cell's accessible name and identity; component tests pin offering, picking, and that typed-but-unpicked text is not saved
- [x] 2.2 The picker's options are not clipped by the grid's scrolling frame

## 3. Completion

- [ ] 3.1 Focused web and browser tests, typecheck, strict OpenSpec validation, full effective acceptance with no pending steps, boot smoke
- [ ] 3.2 Independent headless check at 1280px against the issue's "Done when"
- [ ] 3.3 Sync the delta into the main spec and archive the change
