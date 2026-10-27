# Workflow and Approvals

## Purpose

A workflow moves a row through named states one action at a time, and only
lets the right people take each action. A Table can also require its rows to
be finalised before they count as done, so a finalised row is changed only by
cancelling it, never by editing it directly. Who may submit, cancel or amend a
row at all is covered by permissions-and-roles, not here.

## Requirements

### Requirement: Move a row forward with an allowed action

Opening a row under a workflow SHALL show its current state and only the
actions the user's roles allow from that state; taking one moves the row to
its next state and records who did it. A workflow's own roles decide who may
take its actions — separately from whoever can otherwise read or edit the
row.

#### Scenario: Approve a pending request

- **WHEN** a user holding the Approver role opens a request waiting for
  approval and chooses Approve
- **THEN** the request's state becomes Approved
- **AND** the record of who approved it is kept with the request

#### Scenario: Editing the row doesn't carry approval rights

- **WHEN** a user who can otherwise edit the request does not hold the
  Approver role
- **THEN** they cannot take the Approve action, even though they could
  change the request's other fields

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

#### Scenario: Nobody is emailed who can't or needn't act

- **WHEN** an Approver submits a request themselves, while other Approvers
  include one whose account is switched off and one with no email address
- **THEN** the submitting Approver and those two are not emailed

#### Scenario: A final state needs no decision

- **WHEN** an Approver approves a request, moving it to a state with no
  further actions
- **THEN** no one is emailed

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

### Requirement: Only one workflow governs a Table

A Table SHALL have at most one active workflow, including when users activate alternatives at the same time. A conflicting save SHALL be refused with the existing active workflow's name, rather than choosing whichever workflow was edited most recently.

#### Scenario: Save a competing workflow

- **WHEN** the user saves a second active workflow for a Table that already has one
- **THEN** the save is refused and names the existing active workflow
- **AND** the existing workflow continues to govern the Table

#### Scenario: Activate alternatives at the same time

- **WHEN** the user and another administrator activate different workflows simultaneously for a Table with no active workflow
- **THEN** only one activation succeeds
- **AND** the refused activation names the workflow that became active

### Requirement: Switch workflows explicitly

The user SHALL be able to keep inactive alternatives and switch to one by deactivating the current workflow first. Different Tables SHALL be able to have their own active workflows independently.

#### Scenario: Keep an alternative and switch to it

- **WHEN** the user saves an inactive alternative, deactivates the current workflow, and activates the alternative
- **THEN** each save succeeds and the alternative governs the Table

#### Scenario: Activate workflows for separate Tables

- **WHEN** the user activates a workflow for each of two different Tables
- **THEN** both activations succeed and each workflow governs its own Table

### Requirement: A workflow can drive a field the Table already has

A workflow SHALL be able to use a choice field the Table already has as its state, instead of adding a separate one. A workflow that names a field the Table doesn't have SHALL be refused.

#### Scenario: Use an existing status field

- **WHEN** a workflow is set up to use a Table's existing status field and the user takes an action on a row
- **THEN** that status field changes to the action's next state
- **AND** the Table gains no extra state field

#### Scenario: Name a field that isn't there

- **WHEN** the user saves an active workflow that names a field the Table doesn't have
- **THEN** the save is refused

### Requirement: A row's state changes only through the workflow

A new row under a workflow SHALL start at the workflow's first state, whatever the user typed. After that, editing the row SHALL NOT change its state; only taking an action does.

#### Scenario: Edit the state directly

- **WHEN** the user edits a row and changes its state field by hand
- **THEN** the edit is refused and the row keeps its state

#### Scenario: Create a row in a later state

- **WHEN** the user creates a row and types a later state into its state field
- **THEN** the row is created at the workflow's first state

### Requirement: A workflow's steps must fit its states

A workflow SHALL be refused unless it has at least one state and every action starts and ends at a state the workflow defines.

#### Scenario: An action leads to a state that doesn't exist

- **WHEN** the user saves a workflow with an action that moves a row to an undefined state
- **THEN** the save is refused and the workflow is not created
