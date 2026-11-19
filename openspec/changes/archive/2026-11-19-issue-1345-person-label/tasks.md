## 1. Server (#1345 slice 1)

- [x] 1.1 Table setting `person_column` (migration 0182): a link to Person; kept on update, renamed with the column, carried in an app's replay
- [x] 1.2 Person labels: the platform layer (current employee code, email), gated by the viewer's read on Person, batched
- [x] 1.3 The app layer from `people.describe` (#1267), ~300 ms in search; each job may name its business role; store and role shown only where the viewer may read them
- [x] 1.4 Search folds person-record hits into their Person and sends each Person hit its label

## 2. Web

- [x] 2.1 PersonLabel in shop-floor (stacked and inline), with a story
- [x] 2.2 Search results are links; a person reads by PersonLabel; no two results read the same

## 3. Dash

- [x] 3.1 Dash's describe names each job's business role (#1218), as Explain finds it

## 4. The instance's own Tables

- [x] 4.1 A settings file sets Metadata Overrides from an allowlist (person_column, search_columns, label); applying twice changes nothing; a hand-made override is replaced with a warning; break glass cannot write one
- [x] 4.2 The Dash instance's settings file folds Employee into its Person and finds it by its code
- [x] 4.3 A leaver reads Former Staff with the day they left (only where the viewer may read its field) and their code

## 5. Checks

- [x] 5.1 Codex review of access and the hook boundary (max 3 rounds)
- [x] 5.2 Consistency check against the existing search and list; verifier against #1345's checklist; shots
