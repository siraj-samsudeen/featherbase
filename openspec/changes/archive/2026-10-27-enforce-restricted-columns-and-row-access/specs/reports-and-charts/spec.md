## ADDED Requirements

### Requirement: A scheduled email shows what its creator can see

A scheduled report email SHALL show its recipients only the rows and columns
the person who set up the schedule can see, whether it goes out on its
schedule or is sent at once. Only its creator, or a System Manager, SHALL be
able to change which report it sends or to whom. A schedule whose creator can
no longer sign in SHALL send nothing, and the other schedules still go.

#### Scenario: A planner's weekly report

- **WHEN** a planner who may read only their own orders schedules a weekly
  report of orders
- **THEN** each recipient gets the planner's orders and no one else's

#### Scenario: A colleague redirects the schedule

- **WHEN** a colleague who may edit the planner's schedule changes its
  recipients to an outside address
- **THEN** the change is refused; only the planner or a System Manager may
  change which report it sends or to whom

#### Scenario: The creator has left

- **WHEN** the person who set up a schedule is disabled and its time comes
- **THEN** that report is not sent, and the other due reports are

### Requirement: A scheduled email is never cut short

A scheduled report email SHALL attach every row its creator can see, however
many there are.

#### Scenario: A long report

- **WHEN** a scheduled report covers 601 rows
- **THEN** the attachment holds all 601 and the email says so
