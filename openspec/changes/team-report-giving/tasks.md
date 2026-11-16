## 1. Tests first

- [ ] 1.1 Rule tests for the team: reports_to by job assignment id and by employee id, ended jobs, left staff, the manager excluded
- [ ] 1.2 Platform tests: give in team; refuse outside team, unheld report, self, role/job; direct Table write refused; remove only own team grant; page narrowed; Report Access Manager unchanged

## 2. Platform

- [ ] 2.1 Save rules get the writer's roles

## 3. Dash

- [ ] 3.1 Team Report Manager role, grants (own rows only), version step
- [ ] 3.2 Team scope on access_page, person_search, person_lookup, give_report, remove_report_access; save-rule guard
- [ ] 3.3 Page: team note, Person-only give, hidden bundle tools and waiting list; picker layouts behind a toggle

## 3b. After #1212 lands (#1169's upgrade rule)

- [ ] 3b.1 Rebase onto main as Dash 0.13.4; the upgrade test from 0.13.1 applies the role and its three grants, the write one own rows only

## 3c. After #1216 lands (who a person is)

- [ ] 3c.1 Rebase onto #1216; the team list, Type a name search (name or employee code) and Who has what show the same identity lines (code · job · site)

## 4. Checks

- [ ] 4.1 Verifier: spec vs built with screenshots against #1217's checklist
- [ ] 4.2 Codex standard and adversarial reviews until clean
- [ ] 4.3 Sync specs and archive
