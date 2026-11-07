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

#### Scenario: One broken condition doesn't hide the other actions

- **WHEN** a request has two actions open from its state and one of them has a
  condition that cannot be evaluated
- **THEN** the user opening the request is offered the other action, and only
  the broken one is hidden

### Requirement: A disallowed action changes nothing

Taking an action that isn't available from the row's current state, or that
the user's roles don't allow, SHALL be refused and SHALL leave the row's state
unchanged.

#### Scenario: A role-less attempt is refused

- **WHEN** a user who does not hold the required role tries to take an action
- **THEN** it is refused and the row stays in its current state

### Requirement: Entering a pending state notifies who can act next

A row that arrives in a state explicitly marked as waiting for approval,
whether moved there by an action or created there, SHALL email everyone who
holds a role that can act on it from there, linking to the row and naming the
actions open to them. Unmarked states SHALL send no approval emails.

#### Scenario: Submitting for approval notifies the approver

- **WHEN** a user submits a request, moving it into a state marked as waiting for an
  Approver
- **THEN** each Approver gets an email linking to the request and naming the
  actions they can take on it

#### Scenario: A request that starts out waiting notifies the approver

- **WHEN** a workflow's first state is marked as waiting for an Approver and a
  user creates a request
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

#### Scenario: Ordinary work does not ask for approval

- **WHEN** the user moves a request into an unmarked Draft or Rejected state with actions restricted to staff
- **THEN** no staff member receives an approval email

#### Scenario: Choose which states need approval

- **WHEN** the user edits a workflow and marks a state as waiting for approval
- **THEN** the choice is kept when the workflow is reopened
- **AND** existing and newly added states remain unmarked until the user chooses otherwise

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

### Requirement: Concurrent workflow actions have one winner

Concurrent actions from the same row state SHALL be judged against the state left by the preceding committed action. An action no longer available SHALL be refused without another approval record or notification.

#### Scenario: Two approvers act together

- **WHEN** two approvers approve the same pending request at the same time
- **THEN** only one approval succeeds and only one approval is recorded
- **AND** the other attempt is refused because approval is no longer available

#### Scenario: Competing branches

- **WHEN** two approvers choose different actions from the same pending state at the same time
- **THEN** only the first action succeeds and the other cannot overwrite its result

### Requirement: A change can wait for approval

An app SHALL be able to hold a change to a row as a Change Proposal, with each changed column's original, proposed and reviewed value and the people or roles who approve it. The row SHALL NOT change until the proposal is approved. Change Proposals SHALL be written only by the platform.

#### Scenario: A proposal leaves the row alone

- **WHEN** an app proposes a change to a row
- **THEN** the row is unchanged and a pending proposal shows the new value

#### Scenario: Nobody else can approve

- **WHEN** the only possible approver is the maker
- **THEN** the proposal is refused, saying why

### Requirement: Approving applies the change once, keeping history

Approving SHALL need no edit permission on the Table. It SHALL end the old row and add a new dated row, or add the new row, in one transaction, through the Table's normal save rules, with history naming the maker and the approver. Rejecting SHALL change nothing and SHALL record who rejected it and why.

#### Scenario: The maker can't approve

- **WHEN** the maker approves their own proposal, whatever roles they hold
- **THEN** it is refused and nothing changes

#### Scenario: A reviewed value changed

- **WHEN** a reviewed value changed since the proposal
- **THEN** approving moves it to Needs fresh review and changes nothing

#### Scenario: Two approvals at once

- **WHEN** two approvers approve the same proposal at once
- **THEN** one applies it and the other changes nothing

#### Scenario: Another proposal on the same row

- **WHEN** a proposal is applied while another waits on the same row
- **THEN** the other moves to Needs fresh review

### Requirement: Approval rules decide what happens to a change

A System Manager SHALL be able to add approval rules to a Table, as data with history. A rule says which columns and rows it covers, who may make the change (a role, or a person an app names for the row, such as the row's site lead), and whether the change applies at once and is logged, or waits for approvers. A Table with no rules SHALL work as before.

#### Scenario: A rule that can't work is refused when saved

- **WHEN** the user saves a rule that waits for approval but names no approver, or whose only approver is the maker it names
- **THEN** it is refused, saying why

### Requirement: A maker's change waits for the approver

When a rule routes a change to approvers, the row SHALL stay unchanged and the change SHALL wait as a pending proposal showing the old and new values. The approvers SHALL be emailed with a link, as for any state that waits for approval. The maker SHALL never be one of the approvers.

#### Scenario: A Helper's change waits for the site lead

- **WHEN** a Helper changes a shelf's label and a rule sends Helpers' changes to the shelf's site lead
- **THEN** the shelf keeps its old label, a pending proposal shows the new one, and the site lead is emailed

#### Scenario: Nobody else could approve

- **WHEN** the only person who could approve the change is the maker
- **THEN** the change is refused, saying why

### Requirement: Approving applies the change, rejecting leaves the row alone

An approver SHALL be able to approve without permission to edit the row. Approving SHALL check again that the maker may still make the change and that the values it was based on are unchanged, then apply it, with history naming the maker and the approver. Rejecting SHALL need a reason and SHALL change nothing.

#### Scenario: The site lead approves

- **WHEN** the site lead approves the Helper's pending change
- **THEN** the shelf shows the new label and its history says the Helper changed it and the site lead approved it

#### Scenario: The site lead rejects

- **WHEN** the site lead rejects the change, saying why
- **THEN** the shelf is unchanged and the proposal records who rejected it and why

#### Scenario: The value changed meanwhile

- **WHEN** someone else changes the label before the site lead approves
- **THEN** approving changes nothing and the proposal asks for a fresh review, showing the current value; approving again then applies it

### Requirement: Several approvers, all or any

A rule SHALL be able to name several approvers and require all of them, each a different person, or any one of them.

#### Scenario: Two approvals needed

- **WHEN** a rule needs both the site lead and a Region Lead, and only the site lead has approved
- **THEN** the change still waits, and it applies once the Region Lead approves too

#### Scenario: Any one approval is enough

- **WHEN** the same rule needs any one of them and the Region Lead approves
- **THEN** the change applies and is no longer waiting for the site lead

### Requirement: A maker's own change can apply at once

A rule SHALL be able to let a maker's change apply at once, with history recording who made it. When several rules cover a change, one that waits for approval SHALL win over one that applies at once.

#### Scenario: The site lead's own change applies

- **WHEN** the site lead changes their own site's shelf and a rule applies the site lead's changes at once
- **THEN** the shelf changes immediately, no proposal is made, nobody is emailed, and history names the site lead

### Requirement: A change no rule allows is refused

Once a Table has an active rule, a change that no rule allows SHALL be refused and change nothing, and System Managers SHALL be emailed about the change no rule covers.

#### Scenario: Rules differ by row

- **WHEN** a rule lets Helpers change site A's shelves and no rule covers site B, and a Helper changes a site B shelf
- **THEN** it is refused, saying no approval rule covers it, and System Managers are emailed

#### Scenario: A central Table

- **WHEN** the only rule on a Table lets Region Leads make changes and a site lead changes a row
- **THEN** it is refused and the row is unchanged

### Requirement: Every way of changing a row obeys the rules

The rules SHALL hold the same way for a new row and a change, however it is made: the form, inline and bulk edits, imports and the API. A held new row SHALL not appear in the Table until it is approved.

#### Scenario: A bulk edit by a Helper

- **WHEN** a Helper bulk edits the label of three site A shelves
- **THEN** each shelf keeps its label and each has its own pending proposal

#### Scenario: A new shelf waits

- **WHEN** a Helper adds a shelf to site A
- **THEN** the shelf is not in the Table until the site lead approves it

### Requirement: People see what waits and who it waits for

A held save SHALL tell the maker who it waits for. Everyone who can read a row SHALL see its pending proposals; only someone who may decide one SHALL see Approve and Reject. Bulk edits and imports SHALL say how many rows wait. An approver SHALL find everything waiting for them on one page, which a new row's approval email opens.

#### Scenario: The maker is told who the change waits for

- **WHEN** a Helper saves a new label on a shelf's form and a rule sends it to the site lead
- **THEN** the form says the change is waiting for approval from the site lead and still shows the old label

#### Scenario: Only an approver can decide

- **WHEN** the Helper, a reader and the site lead open the shelf
- **THEN** all three see the pending change, and only the site lead sees Approve and Reject

#### Scenario: The approver's page

- **WHEN** the site lead opens the page of what waits for their approval
- **THEN** it lists the Helper's change and the Helper's new shelf, each with Approve and Reject
