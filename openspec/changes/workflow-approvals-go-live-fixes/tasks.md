# Tasks

## 1. One broken condition hides only its own action (#516)

- [x] 1.1 Add a failing test: with one action's condition broken, the row's action list still loads and offers the other action.
- [x] 1.2 Hide only the action whose condition can't be worked out, and log it.

## 2. A row created in a pending state notifies its approvers (#336)

- [x] 2.1 Add failing tests: a row created in a state that waits on an Approver emails each Approver with a link and the open actions; an Approver who creates it is not emailed; a row created in a final state emails no one.
- [x] 2.2 After a create commits, notify the approvers of the row's starting state by the same rule as moving into it.

## 3. Verification

- [ ] 3.1 Run the server suite, both typechecks and `pnpm check:specs`; verify the change against the code and tests, then archive it.
