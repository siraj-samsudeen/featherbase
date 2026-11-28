## ADDED Requirements

### Requirement: A review ticket opens the Link screen

Every review ticket SHALL link to the Link MotherDuck accounts screen at its account, and the umbrella to the screen. A sync SHALL add the link to an open review ticket raised without it, once (#1463).

#### Scenario: A ticket raised before the link

- **WHEN** an open review ticket has no link and the sync runs twice
- **THEN** the first run adds the link and the second changes nothing
