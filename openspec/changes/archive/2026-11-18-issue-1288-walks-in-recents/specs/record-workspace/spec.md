## MODIFIED Requirements

### Requirement: The path bar shows only for a real path

A list or row page SHALL show the path bar, with its Back, Forward, Copy link and Recent paths, only when the address holds two or more steps. With one step the bar SHALL NOT show, since it would only repeat the page's heading, and nothing else shows in its place. A person's remembered walks SHALL be offered in the sidebar's Recently Opened, so a walk can be reopened after signing in (#1288).

#### Scenario: A plain list

- **WHEN** a person opens a list with no related rows followed
- **THEN** no path bar shows

#### Scenario: A plain list with a remembered walk

- **WHEN** a person who took a walk signs in again and opens a list with no related rows followed
- **THEN** no path bar and no Recent paths button show, and the sidebar's Recently Opened offers the walk by its steps' names

#### Scenario: A walk reopened from Recently Opened

- **WHEN** a person opens a remembered walk from the sidebar's Recently Opened
- **THEN** the page opens at the walk's last step, and the path bar shows every step of it

#### Scenario: A walk

- **WHEN** a person adds a filter or follows a link to a related row
- **THEN** the path bar shows both steps

#### Scenario: Back along the path

- **WHEN** a person presses the bar's Back to the first step
- **THEN** the bar stays, with Forward available
