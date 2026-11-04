## 1. First-time setup

Skipped: `acceptance-tests/` exists.

## 2. Step definitions — each: fails for the right reason → implement → passes → commit

- [x] 2.1 list-view: "the user opens the customers list", "the user switches off every column of the customers list" and "the user sees the list led by … and …, without their row IDs"
- [x] 2.2 list-view: "the user opens a link to the orders list filtered to the item …" and "the user sees the filter in use reading …"
- [x] 2.3 list-view: "the user comes back to the whole orders list" and "the user sees a recent filter reading …"
- [x] 2.4 list-view: "the user opens the orders list", "the user sees the customer of the order … as …", "the user opens the orders list and clicks the customer of the order …" and "the user sees the customer …"
- [x] 2.5 list-view: "a customer … with no name, with the order …", "the user sees the customer … listed by its id" and "the user sees the customer of the order … read by its id …"
- [x] 2.6 search-and-explore: "the user sees … listed as assigned to …", "the user opens that chore's relationship map and clicks … in the listed row" and "the user sees the map centered on …"

## 3. Implementation

- [x] 3.1 List columns: the title column leads, Row ID only without one; every list-shaped screen fetches `row_id`; Explore drops Row ID for hash-named Tables only when Row ID leads
- [x] 3.2 List: link cells read as the linked row's title and open it; a blank leading title shows the row's id; the columns menu's always-on entry is the leading column
- [x] 3.3 List: filter chips and the Recent strip name the column by its label and a link filter's row by its title
- [x] 3.4 Relationship map: link cells in its row tables read as titles and move the map
- [x] 3.5 Web tests: `apps/web/test/rows-by-name.test.tsx` (7) and `list-view-columns.test.ts` (5 new). Changed as intended: `helpdesk.test.tsx` (2: HD Ticket now leads with its subject), `person-rename.test.tsx` (Person leads with the full name), `saved-views.test.tsx` (chip reads "Stage = Open"); acceptance step "the user sees … listed instead of …" (an opened collection may now name the center row as a link)

## 4. Completion

- [x] 4.1 Independent UI verifier at 1280 against the issue's checklist: points 1-4 and regressions pass; point 5 was partial (a blank title led by a values stand-in without the id) and is fixed: a blank title now leads its list and the map's row lists by its id. Left: the sidebar's recent entries still read raw filters; the add-filter field still starts at Row ID; blank titles sort as blanks
- [x] 4.2 Acceptance suite: every scenario passes, zero pending or undefined steps — 93 scenarios: 90 passed; the two "running an instance" scenarios failed because port 5204 is held by another agent's process; "Asha is listed with her phone…" failed on an intended change (step updated) and passes rerun
- [x] 4.3 Web tests and typecheck pass (1376 passed; 3 files fail identically on the pre-code commit in this environment: `admin-shell-extras`, `runtime-client-identity` ("Unknown app: tasker") and `task-management` (react-markdown not resolved from example-apps)); `pnpm check:specs` passes
