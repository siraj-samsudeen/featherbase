## 1. Bounded UI fixes

- [x] 1.1 Disambiguate awesomebar destinations; check collision text and unchanged Enter precedence.
- [x] 1.2 Serialize theme/palette updates; check delayed older success, older failure, latest failure, cache and mirror rollback.
- [x] 1.3 Introduce role-specific contrast tokens; check all eight palette/mode combinations and representative computed styles.
- [x] 1.4 Move and name the multi-sheet warning; check asymmetric sheet names, DOM position and single-sheet/clear transitions.
- [x] 1.5 Expose SourceBrowser column/FK proposals; check selected, reflected, unselected, wrong-schema and wrong-key targets without reflection calls.
- [x] 1.6 Associate generated controls and child cells with labels; check getByLabelText, unique/stable IDs and row changes.

## 2. Integration and evidence

- [x] 2.1 Run web unit tests, targeted e2e, web typecheck and pnpm check:specs; record exact results and limitations.
- [x] 2.2 Render affected default/non-default/error states, inspect captured screenshots and retain representative evidence.
- [x] 2.3 Refresh origin/main, verify final diff, push one branch and open one PR linking the six issues; hand final diff/evidence to the parent for independent review (PR #306).

Verification on 2026-09-22: 27 web unit files / 171 tests, 19 PostgreSQL source tests,
21 targeted browser tests (including 144 WCAG contrast pairs), web typecheck and
`pnpm check:specs` passed. Eight screenshots were captured and inspected, including
preference rollback, failed source load and form save failure. Independent final
review/exploratory handoff remains the parent coordinator's gate. Existing dark-mode
gray helper text and the child-grid's hardcoded white header are outside this role-
contrast scope, not evidence of whole-app accessibility compliance.

## 3. Independent review corrections (#293)

- [x] 3.1 Give visible attachment actions field-specific accessible names and test keyboard file-chooser activation for two Attach fields and one Attach Image field.
- [x] 3.2 Preserve persisted and unsaved child control nodes/IDs through edits, reorder and removal, with unique identities across repeated grids and positions only in accessible names.
- [x] 3.3 Inspect attachment-action and persisted/unsaved child-grid screenshots; rerun focused and integrated verification before handing the new HEAD back for independent re-review.
