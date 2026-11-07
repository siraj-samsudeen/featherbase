## 1. Tests first

- [x] 1.1 Unit tests for the fix-by time, the clock text and the warranty-soon rule
- [x] 1.2 Server tests: install, roles (staff can't change the register or a job), a report becomes a job with its place and fix-by time, a priority change moves it, assigning, Fixed needs a note
- [x] 1.3 Web component tests: the asset page and its report form, the label sheet for one place, the jobs board with assign and fix
- [x] 1.4 One browser journey: open an asset by its address, report a fault, see it on the board

## 2. Assets app

- [x] 2.1 App skeleton (`client-apps/jeyarama/equipment`), manifest with places, asset types, assets, jobs, three roles, permissions; built by `pnpm apps:prepare`
- [x] 2.2 Server rules for jobs: place and fix-by time, state on assignment, Fixed needs a note (any Assets person can be assigned; only technicians and managers can change a job)
- [x] 2.3 Pages: repair jobs board, assets list by place, asset page with report form and history, label sheet with QR codes
- [x] 2.4 Development sample data with Jeyarama's places, assets and jobs

## 2b. Follow the Asset Management BRD (step 1)

- [x] 2b.1 Tests first: place path, workflow state, cover notice (unit); timeline stamps, confirmation by someone else, no reopening after confirmation (server); SAP block, four states, ownership, timeline and confirm button (web)
- [x] 2b.2 Legal entities, place hierarchy, SAP links, owner, operator, cost centre, custodian, four states, AMC
- [x] 2b.3 Job timeline stamps, cause, spares, outside service; repair confirmations
- [x] 2b.4 Pages: asset page SAP block, states and ownership; job timeline, cover notice and confirm; board Closed column
- [x] 2b.5 Sample data for ATK 1501, Enchakkal WH 9151 and a Chennai store

## 2c. Physical verification counts (BRD VER-01..03, step 2)

- [x] 2c.1 Tests first: review lines and outcome counts (unit); planning, start action and its fixed list, blind counters, scans with reasons and duplicates, reviewer separation, recount, decisions and close (server); counts page, blind count page, review page, asset's last verified (web)
- [x] 2c.2 Tables: counts, counters, expected list (managers only), scans, decisions; the start action
- [x] 2c.3 Server rules: scan, decision, counter and count-stage checks; close only with every decision
- [x] 2c.4 Pages: Counts list and planning, blind count page with recount list, review page, last verified on the asset page
- [x] 2c.5 One isolated browser journey; sample ATK count in review for the owner

## 3. Proof

- [x] 3.1 Try every checklist item in the browser against the running app, with screenshots
