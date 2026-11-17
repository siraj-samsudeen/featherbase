## 1. Tests first

- [x] 1.1 Server tests: same rows for raiser, assignee and any reader; other tickets' rows and unshown columns never sent; links only for readers; refused callers get nothing; unlinked Table; upgrade from 0.2.9
- [x] 1.2 Scenarios for the list and its links, red against 0.2.9

## 2. Tickets

- [x] 2.1 `detail` reads the ticket's Data Quality Rows as a base Table after the ticket itself, sorted open first, with a per-row link flag judged as the caller
- [x] 2.2 The "Rows this ticket covers" card on the Request tab, first 10 then "Show all"
- [x] 2.3 Version 0.2.10 with an empty upgrade step from 0.2.9

## 3. Review rounds

- [x] 3.1 Platform `baseTables.available(table)`: a Table unlinked, deleted or reshaped since is left out, never failing the page (Codex adversarial, round 1)
- [x] 3.2 Caller-scoped lookups page past 500 (Codex, round 1)
- [x] 3.3 The Request tab leads with the original message; row status, raiser and assignee link to their records for viewers who may open them
