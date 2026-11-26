## ADDED Requirements

### Requirement: Every sidebar carries the platform's defaults

For someone who can use the Admin, the Admin's sidebar and every app's SHALL carry the platform's defaults: the bell, Recently Opened, Frequent and Saved Views, in an app drawn by the platform below the app's own rows, each opening by address. Someone who cannot use the Admin SHALL get none of them, and the page SHALL ask for none of them (#1385).

#### Scenario: Recently Opened on an app's page

- **WHEN** someone who can use the Admin opens a Table, then an app's page
- **THEN** the app's sidebar lists that Table under Recently Opened, and choosing it loads the Table's page

#### Scenario: No defaults without the Admin

- **WHEN** someone who can open only an app opens its page
- **THEN** its sidebar has no bell, no Recently Opened and no Saved Views, and the page asks for neither list
