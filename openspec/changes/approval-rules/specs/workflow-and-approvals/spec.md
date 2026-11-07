# Workflow and Approvals

## ADDED Requirements

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
