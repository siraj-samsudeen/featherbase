## ADDED Requirements

### Requirement: A rule keeps working when what it names is renamed

Renaming the master Table, the Source Link Table, or a column a sync rule names on the master, the link or the copied
table SHALL carry the new name into the rule. The next sync SHALL run as before, and SHALL NOT raise again a
difference that was already raised.

#### Scenario: People renamed to Members

- **WHEN** a System Manager renames People to Members and its phone column to mobile, with a phone difference already
  raised
- **THEN** the next refresh syncs Members, applies StyleHR's changes, and raises nothing new
