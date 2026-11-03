## 1. First-time setup

Skipped: `acceptance-tests/` exists.

## 2. Step definitions — each: fails for the right reason → implement → passes → commit

- [ ] 2.1 list-view / core-forms: "orders from the customers … and …" (made-up Customer and Order tables through the API)
- [ ] 2.2 list-view: "the user types … into the orders list's quick customer filter and picks …" and "the user sees only the orders from …"
- [ ] 2.3 list-view: "the user types … into the orders list's quick customer filter" and "the user is offered … and no way to create a customer"
- [ ] 2.4 list-view: "the user opens a link to the orders list filtered to the customer …" and "the user sees the quick customer filter reading …"
- [ ] 2.5 list-view: "the orders list filtered to the customer …", "the user clears the quick customer filter" and "the user sees the orders from both … and …"
- [ ] 2.6 core-forms: "the user types … into a new order's customer and picks …", "the user was offered only …" and "the user sees the saved order's customer as …"

## 3. Implementation

- [ ] 3.1 Link picker: falls back to the target Table's title column when it has no picker of its own; a filter flag leaves out "create new"
- [ ] 3.2 List quick filters: a link column renders the link picker with an `=` filter and a clear control
- [ ] 3.3 Web unit tests for the quick filter and the picker fallback; update tests that pinned the text-box filter

## 4. Completion

- [ ] 4.1 Independent UI verifier at 1280 against the issue's checklist; differences fixed
- [ ] 4.2 Acceptance suite: every scenario passes, zero pending or undefined steps
- [ ] 4.3 Web tests and typecheck pass; `pnpm check:specs` passes
