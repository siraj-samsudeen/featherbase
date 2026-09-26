# Usable on Any Device Delta

## MODIFIED Requirements

### Requirement: Works by keyboard

Every control SHALL work by keyboard, and the user can always see which control
has focus.

#### Scenario: Use a screen without a mouse

- **WHEN** the user moves through a screen using only the keyboard
- **THEN** they can reach and use every control
- **AND** they can always see which control they are on

#### Scenario: Move past a closed panel

- **WHEN** the user moves through a phone screen while a panel is closed
- **THEN** focus skips the controls hidden inside it
- **AND** focus returns to those controls when the user opens the panel

#### Scenario: Use the same navigation on a desktop

- **WHEN** the user moves through a desktop screen using only the keyboard
- **THEN** they can reach the navigation controls that remain visible
