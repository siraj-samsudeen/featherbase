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

### Requirement: Entering a pending state notifies who can act next

A row that arrives in a state still needing a decision, whether moved there
by an action or created there, SHALL email everyone who holds a role that can
act on it from there, linking to the row and naming the actions open to them.

#### Scenario: Submitting for approval notifies the approver

- **WHEN** a user submits a request, moving it into a state that waits on an
  Approver
- **THEN** each Approver gets an email linking to the request and naming the
  actions they can take on it

#### Scenario: A request that starts out waiting notifies the approver

- **WHEN** a workflow's first state waits on an Approver and a user creates a
  request
- **THEN** each Approver gets an email linking to the new request and naming
  the actions they can take on it

#### Scenario: Nobody is emailed who can't or needn't act

- **WHEN** an Approver submits a request themselves, while other Approvers
  include one whose account is switched off and one with no email address
- **THEN** the submitting Approver and those two are not emailed

#### Scenario: A final state needs no decision

- **WHEN** an Approver approves a request, moving it to a state with no
  further actions
- **THEN** no one is emailed
