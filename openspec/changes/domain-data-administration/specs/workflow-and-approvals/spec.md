## ADDED Requirements

### Requirement: Delegated changes can wait without changing live data

An authorised proposed change SHALL either apply immediately or wait for approval according to its applicable rules. A held change SHALL leave the live record unchanged until an authorised person approves it.

#### Scenario: A department manager proposes a contact correction

- **WHEN** the user authorised to maintain departmental contact details submits a phone correction requiring store manager approval
- **THEN** the existing phone remains in use and the proposed correction is available for approval

### Requirement: Decisions preserve the maker and reviewer

Approval SHALL apply the authorised proposal and record its maker and approver. Rejection SHALL preserve the live record and record the reviewer and reason.

#### Scenario: A correction is approved

- **WHEN** the user authorised to approve a proposed phone correction approves it
- **THEN** the new phone takes effect and history identifies both the maker and approver

#### Scenario: A correction is rejected

- **WHEN** the user rejects a proposed correction with a reason
- **THEN** the original value stays in use and the rejection and reason are recorded

### Requirement: A maker cannot approve their own proposal

The user SHALL NOT approve their own held change, regardless of other responsibilities they hold. Immediate application SHALL require an explicit applicable rule rather than self-approval.

#### Scenario: An approver submits their own held change

- **WHEN** the user holds approval authority but is also the maker of a proposal
- **THEN** they cannot approve that proposal

### Requirement: Mandatory approvals cannot be bypassed

When applicable rules overlap, approval SHALL take precedence over immediate application. All applicable approval requirements SHALL be satisfied unless an explicit rule defines an alternative.

#### Scenario: A second permission cannot remove approval

- **WHEN** the user has two permissions for an edit and an applicable rule requires approval
- **THEN** the edit remains held even if another applicable rule allows immediate application

### Requirement: Authority is checked again before applying a proposal

Applying a proposal SHALL require current authority for its maker and reviewer and current access to the affected records. Approval SHALL not authorise an otherwise forbidden change or restore revoked powers.

#### Scenario: An employee leaves the delegated department

- **WHEN** the user reviews a pending correction after its maker has lost authority over that employee
- **THEN** the correction cannot be applied through that proposal

### Requirement: Changed values require fresh review

If an affected value changes after a proposal is made, the proposal SHALL require a new decision showing the original value, the current value and the proposed value. An earlier approval SHALL not overwrite the newer value.

#### Scenario: A phone number changes before approval

- **WHEN** the user reviews a proposed phone correction after someone else has already changed that phone number
- **THEN** the proposal returns for fresh review with all three values
- **AND** no proposed value is applied without a new decision

### Requirement: All routes honour the approval rules

Approval requirements SHALL apply equally to ordinary edits, imports and other ways of changing data. A user whose changes require approval SHALL not apply them directly by choosing a different route.

#### Scenario: An imported correction waits

- **WHEN** the user imports a permitted contact correction governed by an approval requirement
- **THEN** it becomes a held proposal rather than changing the live contact immediately
