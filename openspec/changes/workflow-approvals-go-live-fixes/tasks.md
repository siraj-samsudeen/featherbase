# Tasks

## 1. One broken condition hides only its own action (#516)

- [x] 1.1 Add a failing test: with one action's condition broken, the row's action list still loads and offers the other action.
- [x] 1.2 Hide only the action whose condition can't be worked out, and log it.

## 2. Verification

- [ ] 2.1 Run the server suite, both typechecks and `pnpm check:specs`; verify the change against the code and tests, then archive it.
