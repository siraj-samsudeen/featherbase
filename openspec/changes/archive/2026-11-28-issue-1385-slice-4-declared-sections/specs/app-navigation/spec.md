## ADDED Requirements

### Requirement: An app gives its sidebar rows as data

An app SHALL give its own sidebar rows as data, never markup: fixed sections in its manifest's `sidebar`, and
changing rows through one runtime call. The platform SHALL draw both above its defaults, as it draws the Admin's own
groups, marking the open row. A row named after a platform piece, or going to another site, SHALL never be drawn, and
nothing an app puts inside the sidebar element SHALL be drawn (#1385).

#### Scenario: Declared rows open under the app

- **WHEN** an app's manifest declares a row whose address is `#jobs`
- **THEN** its sidebar shows that row, linking to `#jobs` on the app's own page

#### Scenario: Rows given at run time

- **WHEN** an app's page gives a row with a count of 12 and names it the open one
- **THEN** its sidebar shows the row with 12 beside it, marked as the open page, and in the rail the count is a badge on its icon

#### Scenario: A section that folds

- **WHEN** an app gives a section with its own icon, and the sidebar is collapsed to a rail
- **THEN** the section is that one icon, whose menu lists its rows

#### Scenario: A copy of a default piece

- **WHEN** an app's manifest names a row Recently Opened
- **THEN** Featherbase refuses the app when it is found, saying the row is one of the platform's own pieces

## MODIFIED Requirements

### Requirement: Every sidebar carries the platform's defaults

For someone who can use the Admin, the Admin's sidebar, the account pages' and every app's SHALL carry the platform's defaults: the bell, Recently Opened, Frequent and Saved Views, in an app drawn by the platform below the app's own rows, each opening by address. No app SHALL hide them. Someone who cannot use the Admin SHALL get none of them, and the page SHALL ask for none of them (#1385).

#### Scenario: Recently Opened on an app's page

- **WHEN** someone who can use the Admin opens a Table, then an app's page
- **THEN** the app's sidebar lists that Table under Recently Opened, and choosing it loads the Table's page

#### Scenario: No defaults without the Admin

- **WHEN** someone who can open only an app opens its page
- **THEN** its sidebar has no bell, no Recently Opened and no Saved Views, and the page asks for neither list
