# Workflow and Approvals

## ADDED Requirements

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
