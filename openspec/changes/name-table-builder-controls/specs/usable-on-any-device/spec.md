# Spec Delta

## MODIFIED Requirements

### Requirement: Controls are clearly named

Every control SHALL be clearly named, by visible text or an obvious symbol such
as an arrow. When controls repeat, their names or surrounding context SHALL make
clear which item each control affects.

#### Scenario: Know what a button does

- **WHEN** a newcomer looks at a screen on a phone, where nothing can be hovered
- **THEN** they can tell what each button does

#### Scenario: Build a table with assistive technology

- **WHEN** the user defines a table with several columns and a way to name its rows
- **THEN** assistive technology identifies the purpose of every control
- **AND** identifies which column each repeated control affects
