## 1. Sheet choice is fixed after the first import (#325)

- [x] 1.1 Test first: going back to choose sheets is offered before any import and not after, including after leaving and coming back.
- [x] 1.2 Close the way back once any table in the run has landed, and say why.

## 2. A different file doesn't replace saved work (#326)

- [x] 2.1 Test first: a mismatched file leaves the saved work in place and asks; keeping it waits for the right file; the right file still resumes; choosing the new file starts it fresh.
- [x] 2.2 Hold a mismatched file back and ask, without touching the saved work or the kept rows.

## 3. Verification

- [ ] 3.1 Independent screenshot verifier at 1280px and 375px, light and dark, against the checklists on #325 and #326.
- [ ] 3.2 Web suite, typecheck and the repository checks pass; archive this change.
