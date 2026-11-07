## 1. Tests

- [x] 1.1 Rule tests for reportsGivenTo: every route, ended jobs, malformed rows, reasons
- [x] 1.2 Real-read tests on the platform: no assignment, removed row, role removed, job ended, bundle changed, refusal on open
- [x] 1.3 Scenarios as prose WHEN/THEN, each carried by a Dash platform test (the acceptance runner doesn't load client apps)

## 2. Tables and role

- [x] 2.1 In Dash's manifest and version step: Report Bundle, Report Bundle Member and Report Access, the save rule, Report Access Manager and its grants
- [x] 2.2 Permissions spec records the exception

## 3. Dash

- [x] 3.1 reportsGivenTo and the reads behind the page (needs #967's report table)
- [x] 3.2 Opening a report refuses one outside the list (agreed with #967)
- [x] 3.3 Report access page in shared components
- [x] 3.4 The gate check: has a report, or manages access
- [x] 3.5 New Dash version

## 4. Platform

- [x] 4.1 An app can add its own check to its gate, failing closed
- [x] 4.2 Access Request alert and waiting list reach an app's approver role

## 5. Going live

- [ ] 5.1 First bundles and assignments as a CSV for the owner
- [ ] 5.2 Verifier: spec vs built table with screenshots against #1046
- [ ] 5.3 Sync specs and archive
