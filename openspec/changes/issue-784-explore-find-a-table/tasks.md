## 1. First-time setup

Skipped: `acceptance-tests/` exists.

## 2. Step definitions — each: fails for the right reason → implement → passes → commit

- [ ] 2.1 search-and-explore: "a table of suppliers and a table of purchases, each purchase from a supplier" and "the purchases are from the supplier …"
- [ ] 2.2 search-and-explore: "the user types … in Explore's table search and presses Enter" (an Explore page object)
- [ ] 2.3 search-and-explore: "Explore starts from the purchases"
- [ ] 2.4 search-and-explore: "each purchase shows …"

## 3. Implementation

- [ ] 3.1 Explore: the table search box (written while prototyping; proved by 2.2–2.3)
- [ ] 3.2 Explore cards render links through the row-title lookup, headline included (prototype; proved by 2.4)
- [ ] 3.3 The title loader sends batches of 100
- [ ] 3.4 Web test: `apps/web/test/explore-chains.test.tsx`

## 4. Completion

- [ ] 4.1 Acceptance suite: every scenario passes, zero pending or undefined steps
- [ ] 4.2 Explore, map, Home and Recent web tests pass; `pnpm check:specs` passes
