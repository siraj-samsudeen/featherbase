## Why

Feather Dash's org chart says who holds which job in a store, but not whether that person works
for the group at all, under which company and number, what their HR title is, or how their time
is split. On 04-Nov-2026 the owner and the client's CEO settled these (#928): a person can leave
and rejoin, each stint carrying its own employee number; the HR title sits beside the org-chart
job; a person can hold a home assignment, a second one or a temporary deployment; each section
has an approved headcount range; and the org chart reaches above the store, up to the Director.
Holding these as data lets the HR load, the scopes (#683) and the reports build on one record.

## What Changes

- **Employee**, from #683: a person who works or has worked for the group, with their
  operational contacts. The employee number moves off it.
- **Employment**, new: one row per stint, with the legal company, the employee number that
  company issued, joined on, left on (exclusive; empty while current) and the leaving reason.
  A rejoin is a new row. Saving a stint that overlaps another at the same company, or a number
  that company already gave another person, is refused.
- **Designation** and **designation alias**, new: one clean group-wide list of HR titles, each
  source system's spelling kept beside it as an alias.
- **Job assignment** gains the designation, the assignment type (Primary, Secondary, Temporary
  deployment; Primary by default), the percentage (100 by default) and, for a Cluster Manager,
  the cluster. A person's time that does not add up (two Primary assignments on one day,
  Primary and Secondary over 100%, a deployment larger than the Primary it is taken from) is
  listed on the store's conflict list.
- **Section** gains its approved headcount, a minimum and a maximum.
- **Jobs** gain Director and Chief Operating Officer above the store, beside Cluster Manager.
  A Cluster Manager names the cluster they manage; a store's staff get their Cluster Manager
  through the store's cluster, never typed in per person.

## Capabilities

### New Capabilities

- `feather-dash-people`: who works for the group and in which stints, their HR titles, how their
  time is split across job assignments, the approved headcount of a section, and the jobs above
  the store.

## Impact

- `client-apps/jeyarama/dash`: `featherbase.json` (four new Tables; columns on job assignment and
  section; the job choices), `src/validators.ts`, `src/people.ts`, `src/conflicts.ts`,
  `src/compare-cli.ts`, the made-up seed and the tests.
- No platform change, no migration: new Tables and new optional or defaulted columns.
- Not here: scopes and permissions over these Tables (#683, piece B), the HR loader.
