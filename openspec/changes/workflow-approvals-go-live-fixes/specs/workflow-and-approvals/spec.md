# Workflow and Approvals Delta

## MODIFIED Requirements

### Requirement: An action can depend on the row, not just the user

An action can also require something to be true of the row itself; when that
condition isn't met, the action SHALL be refused, even to an Administrator.

#### Scenario: A condition blocks the action regardless of role

- **WHEN** an approval action requires a request's amount to be under a limit
  and the request is over it
- **THEN** the action is refused until the amount is fixed, however senior the
  user

#### Scenario: A condition that can't be worked out

- **WHEN** an action's condition is written so that it cannot be evaluated and
  the user takes that action
- **THEN** the action is refused and the request stays in its current state

#### Scenario: One broken condition doesn't hide the other actions

- **WHEN** a request has two actions open from its state and one of them has a
  condition that cannot be evaluated
- **THEN** the user opening the request is offered the other action, and only
  the broken one is hidden
