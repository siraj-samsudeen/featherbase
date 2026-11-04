## 1. Tests first

- [x] 1.1 Server: the waiting cohort as a Person list filter: full address, exclusions, All/Guest, a role takes them off, further filtering, newest first, count equals list (red: unknown operator)

## 2. Implementation

- [x] 2.1 `not related` filter operator (Sub-table shape only); app runtime lists refuse it as they refuse `related`
- [x] 2.2 `WAITING_FOR_ACCESS_FILTERS` in shared; the list endpoint removed, the count endpoint kept
- [x] 2.3 The Waiting for access page renders `ListView` for Person behind the filter, with the person's filters in the address
- [x] 2.4 Component tests: standard list with full address, empty state, no-name person identifiable, badge refresh

## 3. Completion

- [x] 3.1 Focused server and web suites, both typechecks, strict OpenSpec validation
- [x] 3.2 Headless browser check at desktop width against #835's "Done when"
- [x] 3.3 Sync the delta into the main spec and archive the change
