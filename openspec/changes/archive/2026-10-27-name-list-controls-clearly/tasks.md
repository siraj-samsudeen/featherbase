## 1. Fixes

- [x] 1.1 Distinct names for the column picker and the link to the Columns screen (#422).
- [x] 1.2 Screen-reader names for the select-all and row checkboxes, the filter pickers and the bulk edit picker (#514).
- [x] 1.3 The new-row shortcut reads the Table from the open page's route, so it does nothing on Jobs, All tables and other fixed Admin pages (#515).

## 2. Verification

- [x] 2.1 Web tests, web typecheck and the spec checks pass.
- [x] 2.2 An independent verifier checks the list at 1280px and 375px, light and dark, against the UI checklist in the issues.

Verification on 27-Oct-2026: web suite 1095 of 1101 passed (the 6 failures, in login-page and sign-in-methods, fail the same way on main in this checkout); controls-named 4 and keyboard-shortcuts 6 passed; column-editor and listview e2e 10 passed; web and server typechecks and the repo checks passed. The independent verifier passed all 11 checklist items at 1280px and 375px, light and dark. Two phone layout problems that were there before this change are filed as #581 and #582.
