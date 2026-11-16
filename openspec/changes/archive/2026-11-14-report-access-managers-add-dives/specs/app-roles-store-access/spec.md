## ADDED Requirements

### Requirement: Data that isn't about stores is read whole

An app MAY declare that a set of its data holds nothing about stores, such as a
list of the reports it could open. Every read SHALL get all of it, whatever
stores the reader is assigned to, and the app's own rules SHALL decide who may
ask for it.

#### Scenario: Someone assigned to no store lists the reports

- **WHEN** someone who manages an app's reports, and is assigned to no store, asks for the list of reports it could open
- **THEN** they get the whole list
