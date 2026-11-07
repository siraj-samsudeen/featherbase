## 1. Tests

- [ ] 1.1 Pure rule tests for reportsVisibleTo: every route, ended jobs, malformed rows, reasons
- [ ] 1.2 Real-read tests on the platform: no assignment, removed row, role removed, job ended, bundle changed, refusal on open
- [ ] 1.3 Acceptance steps for the scenarios, red first

## 2. Tables and role

- [ ] 2.1 In Dash's manifest and version step: both Tables, the save rule, Report Access Manager and its grants
- [ ] 2.2 Permissions spec records the exception

## 3. Dash

- [ ] 3.1 reportsVisibleTo and the reads behind the page (needs #967's report table)
- [ ] 3.2 Opening a report refuses one outside the list (agreed with #967)
- [ ] 3.3 Report access page in shared components
- [ ] 3.4 The gate check: has a report, or manages access
- [ ] 3.5 New Dash version

## 4. Platform

- [ ] 4.1 An app can add its own check to its gate, failing closed
- [ ] 4.2 Access Request alert and waiting list reach an app's approver role

## 5. Going live

- [ ] 5.1 First bundles and assignments as a CSV for the owner
- [ ] 5.2 Verifier: spec vs built table with screenshots against #1046
- [ ] 5.3 Sync specs and archive
