## 1. Platform

- [x] 1.1 An upgrade applies new or wider grants for roles its version declares; All, Guest, platform roles and undeclared roles stay refused; the deploy log names each grant (runtime-upgrades and runtime-privacy-contract tests)
- [x] 1.2 A dataset may be unscoped: no scope filter, every row for every read, the read's own filters still apply (app-datasets tests)

## 2. Dash 0.13.3

- [x] 2.1 Report Access Manager may read and create reports; the version step from 0.13.2 changes no Table (report-manifest test)
- [x] 2.2 The organisation's Dives as an unscoped dataset over MD_LIST_DIVES, read live by `dive_choices`, managers only, out of reach said plainly
- [x] 2.3 `add_report`: a Dive id and a name, refused for a Dive already in Dash, a name already used, an empty name or a non-manager; creates a report taking no filter
- [x] 2.4 The Add a Dive card: search by title or owner, paste a link or id, name and add, then give or bundle at once
- [x] 2.5 Production's 0.13.1 upgrades to 0.13.3 with the grant logged, and a manager adds and gives a Dive (platform test)
