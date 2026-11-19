## 1. Server (#1345 slice 1)

- [ ] 1.1 Table setting `person_column` (migration 0176): a link to Person; kept on update, renamed with the column, carried in an app's replay
- [ ] 1.2 Person labels: the platform layer (current employee code, email), gated by the viewer's read on Person, batched
- [ ] 1.3 `person.describe` in the manifest; called once per request as the viewer, ~300 ms timeout, fail closed, first app with an appointment wins
- [ ] 1.4 Search folds person-record hits into their Person and sends each Person hit its label

## 2. Web

- [ ] 2.1 PersonLabel in shop-floor (stacked and inline), with a story
- [ ] 2.2 Search results are links; a person reads by PersonLabel; no two results read the same

## 3. Dash

- [ ] 3.1 Dash implements `person.describe` from its staff list (code, role, place, standing)

## 4. Checks

- [ ] 4.1 Codex review of access and the hook boundary (max 3 rounds)
- [ ] 4.2 Consistency check against the existing search and list; verifier against #1345's checklist; shots
