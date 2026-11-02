## ADDED Requirements

### Requirement: The settings file can set how often a job runs

The settings file SHALL be able to set how often a scheduled job runs, as well
as whether it runs, from the same fixed list an admin chooses from. A cadence
the file sets SHALL be read-only in Admin, and a cadence not on the list SHALL
be refused with nothing changed.

#### Scenario: Running a job every four hours

- **WHEN** the file sets a daily job to run every four hours and the owner
  previews, then applies it
- **THEN** the preview names the cadence as the setting that would change,
  the apply changes it, and Admin shows the cadence as set in the file

#### Scenario: A made-up cadence

- **WHEN** the file sets a job to run fortnightly
- **THEN** the apply is refused, pointing at that job's cadence, and nothing
  changes
