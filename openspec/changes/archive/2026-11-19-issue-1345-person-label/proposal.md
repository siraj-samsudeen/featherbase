## Why

Search showed six rows reading exactly "<Name> · Employee" or "<Name> · Person" for eight different staff who share one name (#1345, from Siraj on production, 19-Nov-2026). Nothing told them apart, and one human appeared twice: once as their Employee row and once as their Person.

## What Changes

- **PersonLabel**, one shop-floor component for every place a person is named: the name as a RecordLink to the Person, then muted `code · role · place`. This change uses its stacked layout in search. Pickers, reference cells, record headers, Recently Opened and activity lines adopt it in later slices.
- **Two layers of values**, worked out once on the server:
  - The platform gives the person's current employee code, gated by the viewer's read on Person.
  - The app that already says who people are (`people.describe`, #1267: Dash) adds standing, role and place, as the Person page shows them. Each job may now name its business role (#1218). The store and business role show only where the viewer may read them. Search waits about 300 ms for it.
  - With no hook, or a hook that fails or is late, the label reads name · code · email.
- **The fold.** A Table can say "my rows are a person's record, through column X" (`person_column`). Search folds such a row's hit into its Person, so each human appears once. Code search reuses #1346's `search_columns`.
- **Search results are links**, so middle-click and open-in-new-tab work (audit F16/F17/F19). No two results read the same: when name and meta still match, the email is added.

## Capabilities

### New Capabilities

### Modified Capabilities

- `search-and-explore`: one row per human; each person is told apart by code, role and place; results are links.
- `trusted-runtime-packages`: the app that says who people are may name each job's business role.
