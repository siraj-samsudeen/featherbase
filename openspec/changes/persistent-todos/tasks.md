## 1. A created to-do is listed after a restart (@spec created-to-dos-are-listed)

- [x] 1.1 outer: a to-do created before a restart is listed after it, not done
- [x] 1.2 inner: POST /todos returns 201 with the new to-do, not done
- [x] 1.3 inner: GET /todos lists the to-dos created

## 2. To-dos are listed in the order they were created (@spec created-to-dos-are-listed)

- [x] 2.1 outer: "Buy milk" then "Pay rent" are listed in that order

## 3. A to-do without a title is rejected (@spec a-to-do-needs-a-title)

- [ ] 3.1 outer: creating a to-do without a title is rejected and nothing is stored (added)

## 4. Reconcile

- [ ] 4.1 Coverage 100% of lines and functions; every uncovered line ratified, deleted or asked
- [ ] 4.2 No unused files, exports or dependencies (knip)
- [ ] 4.3 Types check clean
- [ ] 4.4 Mutation testing: every surviving mutant ratified, deleted or asked
