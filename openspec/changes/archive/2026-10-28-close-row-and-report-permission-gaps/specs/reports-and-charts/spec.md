## ADDED Requirements

### Requirement: A report a schedule sends changes only with its scheduler

A saved report that a scheduled email sends SHALL be changed only by the
person who set up every schedule that sends it, or by a System Manager,
because the email shows that person's rows and columns. Anyone else allowed
to edit reports SHALL be refused, and the report is kept as it was.

#### Scenario: A colleague widens a scheduled report

- **WHEN** a colleague who may edit reports adds a column to a report that a
  planner's schedule sends
- **THEN** the change is refused and the next email is unchanged

#### Scenario: The planner changes their own report

- **WHEN** the planner who set up the only schedule that sends a report
  changes that report
- **THEN** the change is saved
