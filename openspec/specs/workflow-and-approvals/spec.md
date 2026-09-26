# Workflow and Approvals

## Purpose

A workflow moves a row through named states one action at a time, and only
lets the right people take each action. A Table can also require its rows to
be finalised before they count as done, so a finalised row is changed only by
cancelling it, never by editing it directly.

## Requirements

### Requirement: Move a row forward with an allowed action

Opening a row under a workflow SHALL show its current state and only the
actions the user's roles allow from that state; taking one moves the row to
its next state and records who did it.

#### Scenario: Approve a pending request

- **WHEN** a user holding the Approver role opens a request waiting for
  approval and chooses Approve
- **THEN** the request's state becomes Approved
- **AND** the record of who approved it is kept with the request

### Requirement: An action can depend on the row, not just the user

An action can also require something to be true of the row itself; when that
condition isn't met, the action SHALL be refused, even to an Administrator.

#### Scenario: A condition blocks the action regardless of role

- **WHEN** an approval action requires a request's amount to be under a limit
  and the request is over it
- **THEN** the action is refused until the amount is fixed, however senior the
  user

### Requirement: A disallowed action changes nothing

Taking an action that isn't available from the row's current state, or that
the user's roles don't allow, SHALL be refused and SHALL leave the row's state
unchanged.

#### Scenario: A role-less attempt is refused

- **WHEN** a user who does not hold the required role tries to take an action
- **THEN** it is refused and the row stays in its current state

### Requirement: Entering a pending state notifies who can act next

Moving a row into a state that still needs a decision SHALL email everyone
who holds a role that can act on it from there, linking to the row and naming
the actions open to them.

#### Scenario: Submitting for approval notifies the approver

- **WHEN** a user submits a request, moving it into a state that waits on an
  Approver
- **THEN** each Approver gets an email linking to the request and naming the
  actions they can take on it

### Requirement: Finalise a row instead of leaving it open to change

A Table can require its rows to be submitted before they count as finalised.
Once submitted, a row SHALL NOT be edited directly — cancelling it is the way
to change course, and cancelling is final unless the row is amended into a
fresh draft copy.

#### Scenario: A submitted row is edited

- **WHEN** a user tries to change a row that has already been submitted
- **THEN** the change is refused and the user is told to cancel it first

#### Scenario: Amend after cancelling

- **WHEN** a user cancels a submitted row and then amends it
- **THEN** a new draft copy is created, linked back to the original, ready to
  edit again

### Requirement: Submitting, cancelling and amending are their own permissions

Being able to edit a Table's rows SHALL NOT by itself allow submitting,
cancelling or amending them — each of those requires its own separate
permission.

#### Scenario: Can edit but not cancel

- **WHEN** a user who can edit a Table's rows, but was not given cancel
  permission on it, tries to cancel a submitted row
- **THEN** the cancellation is refused
