# Row Editing

## ADDED Requirements

### Requirement: Read a row using its configured presentation

An existing read-only row with a reading presentation SHALL show its configured title, headers, body, optional attachment names and optional notice before its raw values. Unconfigured, editable and new rows SHALL retain the ordinary form.

#### Scenario: Read a configured reference notice

```gherkin
Given the user can read a reference notice with a configured reading presentation
When the user opens the reference notice
Then the reference notice uses its configured reading presentation
And the ordinary editable reference form remains available for writable rows
```
