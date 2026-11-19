## 1. Server (#1345 slice 1)

- [ ] 1.1 Table setting `person_column` (migration 0176): a link to Person; kept on update, renamed with the column, carried in an app's replay
- [ ] 1.2 Person labels: the platform layer (current employee code, email), gated by the viewer's read on Person, batched
- [ ] 1.3 The app layer from `people.describe` (#1267), ~300 ms in search; each job may name its business role; store and role shown only where the viewer may read them
- [ ] 1.4 Search folds person-record hits into their Person and sends each Person hit its label

## 2. Web

- [ ] 2.1 PersonLabel in shop-floor (stacked and inline), with a story
- [ ] 2.2 Search results are links; a person reads by PersonLabel; no two results read the same

## 3. Dash

- [ ] 3.1 Dash's describe names each job's business role (#1218), as Explain finds it

## 4. Checks

- [ ] 4.1 Codex review of access and the hook boundary (max 3 rounds)
- [ ] 4.2 Consistency check against the existing search and list; verifier against #1345's checklist; shots
