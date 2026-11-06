## 1. Tests first

- [x] 1.1 Unit: employment overlap, rejoin on the day the last stint ended, two companies at once, a number held by another person (`src/people.test.ts`)
- [x] 1.2 Unit: a person's time on a day: one Primary, Primary + Secondary ≤ 100%, deployments within the Primary's share, acting and untyped rows left out
- [x] 1.3 Unit: the conflict list names time that does not add up in every store the person works in; Director and Chief Operating Officer are known jobs
- [x] 1.4 Unit: job assignment shapes (cluster for Cluster Manager only, assignment type, percentage); read grants for the new Tables
- [x] 1.5 Platform (real Postgres): employment refusals, defaults Primary and 100, designation folded uniqueness and aliases, section headcount range

## 2. Implementation

- [x] 2.1 `featherbase.json`: employee, employment, designation, designation alias; job assignment designation, assignment type, percentage, cluster; section approved headcount; the job choices
- [x] 2.2 `src/people.ts`, the validators and the conflict list; the comparison reads the new columns
- [x] 2.3 The made-up seed splits shared time and names the Cluster Manager's cluster

## 3. Completion

- [x] 3.1 Dash unit, platform and frontend suites; strict OpenSpec validation
- [x] 3.2 Codex review, standard and adversarial, until neither raises a blocker
- [x] 3.3 Sync the delta into the main spec and archive the change
