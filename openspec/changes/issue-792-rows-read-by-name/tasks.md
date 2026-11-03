## 1. First-time setup

Skipped: `acceptance-tests/` exists.

## 2. Step definitions — each: fails for the right reason → implement → passes → commit

- [ ] 2.1 list-view: "the user opens the customers list", "the user switches off every column of the customers list" and "the user sees the list led by … and …, without their row IDs"
- [ ] 2.2 list-view: "the user opens a link to the orders list filtered to the item …" and "the user sees the filter in use reading …"
- [ ] 2.3 list-view: "the user comes back to the whole orders list" and "the user sees a recent filter reading …"
- [ ] 2.4 list-view: "the user opens the orders list", "the user sees the customer of the order … as …", "the user opens the orders list and clicks the customer of the order …" and "the user sees the customer …"
- [ ] 2.5 list-view: "a customer … with no name, with the order …", "the user sees the customer … listed by its id" and "the user sees the customer of the order … read by its id …"
- [ ] 2.6 search-and-explore: "the user sees … listed as assigned to …", "the user opens that chore's relationship map and clicks … in the listed row" and "the user sees the map centered on …"

## 3. Implementation

- [ ] 3.1 List columns: the title column leads, Row ID only without one; every list-shaped screen fetches `row_id`; Explore drops Row ID for hash-named Tables only when Row ID leads
- [ ] 3.2 List: link cells read as the linked row's title and open it; a blank leading title reads as the row's stand-in title; the columns menu's always-on entry is the leading column
- [ ] 3.3 List: filter chips and the Recent strip name the column by its label and a link filter's row by its title
- [ ] 3.4 Relationship map: link cells in its row tables read as titles and move the map
- [ ] 3.5 Web tests: new cases for the above; update tests that pinned Row ID first on a titled Table or the raw chip text, each listed in the PR

## 4. Completion

- [ ] 4.1 Independent UI verifier at 1280 against the issue's checklist
- [ ] 4.2 Acceptance suite: every scenario passes, zero pending or undefined steps
- [ ] 4.3 Web tests and typecheck pass; `pnpm check:specs` passes
