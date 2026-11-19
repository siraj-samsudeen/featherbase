## ADDED Requirements

### Requirement: The app that says who people are names their business role

The app that says who people are (`people.describe`, #1267) MAY name, for each
job, the business role it gives (#1218) as a record. Featherbase SHALL show a
job's store and business role only where the viewer may read that record, by
the record's own title, and SHALL wait about 300 ms for the app in search,
showing its own layer alone when the app is off, failing or late (#1345).

#### Scenario: A business role the viewer may read

- **WHEN** Dash says a person's job gives the business role Store Manager, at a store the viewer may not read
- **THEN** the person reads "Store Manager" and no store

#### Scenario: A slow app

- **WHEN** the app takes longer than its time to say who people are
- **THEN** search answers without waiting, showing code and email
