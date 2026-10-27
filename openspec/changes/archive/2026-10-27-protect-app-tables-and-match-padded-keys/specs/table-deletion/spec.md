## ADDED Requirements

### Requirement: An installed app's table is removed by uninstalling the app

A table that belongs to an installed app SHALL NOT be deleted on its own. The
refusal names the app and says to uninstall it, which removes the app's
tables and its installation together, so the app can be installed again
afterwards.

#### Scenario: Deleting one of an app's tables is refused

- **WHEN** the user deletes a table that an installed app added
- **THEN** the deletion is refused, naming the app and saying to uninstall
  it, and the table and the app are unchanged

#### Scenario: Uninstall, then install again

- **WHEN** the user uninstalls that app and installs it again
- **THEN** its tables are back and the app is installed
