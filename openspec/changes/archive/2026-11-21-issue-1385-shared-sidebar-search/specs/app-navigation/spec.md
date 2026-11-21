## ADDED Requirements

### Requirement: Every page offers Search or Command

Every signed-in page with a sidebar, the Admin's and every app's, SHALL offer the same Search or Command field at the top of its sidebar, opened by the same ⌘K / Ctrl+K (never with Shift, which is View As). The command bar SHALL offer only what the viewer can open: someone who cannot use the Admin finds their apps, the apps' tabs and their account pages, and no Table, record or Admin page (#1385).

#### Scenario: An app's page

- **WHEN** someone who can use the Admin presses Ctrl+K on an app's page and types a Table's name
- **THEN** the command bar opens and lists that Table

#### Scenario: Someone who cannot use the Admin

- **WHEN** someone who can open only an app searches the command bar for that app
- **THEN** it lists the app and their account pages, and no Table or Admin page

#### Scenario: View As keeps its key

- **WHEN** someone presses Ctrl+Shift+K
- **THEN** the command bar stays closed
