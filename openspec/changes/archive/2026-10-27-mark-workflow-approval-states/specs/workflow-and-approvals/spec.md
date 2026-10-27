## MODIFIED Requirements

### Requirement: Entering a pending state notifies who can act next

Moving a row into a state explicitly marked as waiting for approval SHALL email everyone
who holds a role that can act on it from there, linking to the row and naming
the actions open to them. Unmarked states SHALL send no approval emails.

#### Scenario: Submitting for approval notifies the approver

- **WHEN** a user submits a request, moving it into a state marked as waiting for an
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

#### Scenario: Ordinary work does not ask for approval

- **WHEN** the user moves a request into an unmarked Draft or Rejected state with actions restricted to staff
- **THEN** no staff member receives an approval email

#### Scenario: Choose which states need approval

- **WHEN** the user edits a workflow and marks a state as waiting for approval
- **THEN** the choice is kept when the workflow is reopened
- **AND** existing and newly added states remain unmarked until the user chooses otherwise
