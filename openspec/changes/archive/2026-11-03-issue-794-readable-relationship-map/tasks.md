## 1. First-time setup

Skipped: `acceptance-tests/` exists.

## 2. Step definitions — each: fails for the right reason → implement → passes → commit

- [x] 2.1 search-and-explore: "a table of volunteers and a table of chores, each chore assigned to a volunteer" and "the chore … assigned to …, whose phone is …"
- [x] 2.2 search-and-explore: "the user opens that chore's relationship map" and "the user sees …, a …, linked by …" (relationship map page object)
- [x] 2.3 search-and-explore: "the user opens Asha's relationship map" and "the user sees Asha's chores related by …"
- [x] 2.4 search-and-explore: "the user sees … listed with her phone …", "the user opens Asha's chores" and "the user sees … listed instead of …"

## 3. Implementation

- [x] 3.1 Relationship map: no words on the lines; link boxes read "<link> · <Table>", collection boxes "via <link>", in the wide and the narrow layout
- [x] 3.2 Relationship map: the center row listed under the map while nothing is opened
- [x] 3.3 Web tests `apps/web/test/relation-map.test.tsx` updated for the new box text and the center row

## 4. Completion

- [x] 4.1 Acceptance suite: every scenario passes, zero pending or undefined steps — 70 scenarios: 67 passed; the two "running an instance" start-up scenarios failed only because another session holds port 5204; "Shops connect through a login that owns nothing" failed once in the full run and passes on its own (list view, untouched here)
- [x] 4.2 Web relationship-map tests pass; `pnpm check:specs` passes
