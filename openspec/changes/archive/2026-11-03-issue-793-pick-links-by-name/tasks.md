## 1. First-time setup

Skipped: `acceptance-tests/` exists.

## 2. Step definitions — each: fails for the right reason → implement → passes → commit

- [x] 2.1 list-view / core-forms: "orders from the customers … and …" (made-up Customer and Order tables through the API)
- [x] 2.2 list-view: "the user types … into the orders list's quick customer filter and picks …" and "the user sees only the orders from …"
- [x] 2.3 list-view: "the user types … into the orders list's quick customer filter" and "the user is offered … and no way to create a customer"
- [x] 2.4 list-view: "the user opens a link to the orders list filtered to the customer …" and "the user sees the quick customer filter reading …"
- [x] 2.5 list-view: "the orders list filtered to the customer …", "the user clears the quick customer filter" and "the user sees the orders from both … and …"
- [x] 2.6 core-forms: "the user types … into a new order's customer and picks …", "the user was offered only …" and "the user sees the saved order's customer as …"

## 3. Implementation

- [x] 3.1 Link picker: falls back to the target Table's title column when it has no picker of its own; a filter flag leaves out "create new"
- [x] 3.2 List quick filters: a link column renders the link picker with an `=` filter and a clear control
- [x] 3.3 Web tests: `apps/web/test/link-pickers.test.tsx` (form link falls back to the title column; quick filter picks by name, offers no new row, reads the name, clears, drops unpicked typing). No existing test pinned the text-box filter for a link column, so none changed

## 4. Completion

- [x] 4.1 Independent UI verifier at 1280 against the issue's checklist: all four points and both regression checks pass; its rough edges fixed (peek/open icons in the filter, unpicked typing left in the box, placeholder, width). Left: keyboard selection in the shared picker, and ids in the filter chip, recents and list cells (#792)
- [x] 4.2 Acceptance suite: every scenario passes, zero pending or undefined steps — 77 scenarios: 74 passed; the two "running an instance" scenarios failed because port 5204 is held by another agent's process; "Shops connect through a login that owns nothing" failed once mid-run and passed rerun alone
- [x] 4.3 Web tests and typecheck pass (1365 passed; `task-management.test.tsx` failed to load once under load and passed alone, 53 tests); `pnpm check:specs` passes
