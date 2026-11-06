## ADDED Requirements

### Requirement: First-run setup stays reachable while it is needed

While the check for a System Manager's email address is failing, the built-in
Administrator SHALL see a banner linking to the setup screen on every Admin page
but that screen, with no way to dismiss it. Instance health's failing check SHALL
link the Administrator to the setup screen and anyone else to the Person table,
and the Admin sidebar SHALL offer the Administrator the setup screen.

#### Scenario: The sign-in offer was never made

- **WHEN** the Administrator signs in by following a link to Instance health, with the check failing
- **THEN** the page they asked for opens, with the banner and its link to the setup screen

#### Scenario: Deferring setup

- **WHEN** the Administrator chooses "Not now" on the setup screen
- **THEN** the Admin opens, and the banner is there on every page and after signing in again

#### Scenario: Another System Manager

- **WHEN** another System Manager opens Instance health with the check failing
- **THEN** they see no banner, and the check links them to the Person table

#### Scenario: The check passes

- **WHEN** a System Manager gets an email address
- **THEN** the banner and the sidebar link go without a reload
