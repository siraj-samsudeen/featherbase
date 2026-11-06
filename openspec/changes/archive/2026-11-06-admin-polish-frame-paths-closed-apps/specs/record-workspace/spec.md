## ADDED Requirements

### Requirement: The path bar shows only for a real path

A list or row page SHALL show the path bar, with its Back, Forward, Copy link and Recent paths, only when the address holds two or more steps. With one step the bar SHALL NOT show, since it would only repeat the page's heading.

#### Scenario: A plain list

- **WHEN** a person opens a list with no related rows followed
- **THEN** no path bar shows

#### Scenario: A walk

- **WHEN** a person adds a filter or follows a link to a related row
- **THEN** the path bar shows both steps

#### Scenario: Back along the path

- **WHEN** a person presses the bar's Back to the first step
- **THEN** the bar stays, with Forward available
