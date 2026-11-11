## MODIFIED Requirements

### Requirement: A change can wait for approval

An app SHALL be able to hold a change to a row as a Change Proposal, with each changed column's original, proposed and reviewed value and the people or roles who approve it. Unless its approval type applies at once, the row SHALL NOT change until the proposal is approved. Change Proposals SHALL be written only by the platform.

#### Scenario: A proposal leaves the row alone

- **WHEN** an app proposes a change to a row, of a type that is approve first
- **THEN** the row is unchanged and a pending proposal shows the new value

#### Scenario: Nobody else can approve

- **WHEN** the only possible approver is the maker
- **THEN** the proposal is refused, saying why

## ADDED Requirements

### Requirement: Each approval type says whether a change waits or applies at once

An app SHALL declare the kinds of approval its proposals come as. Each SHALL be Approve first unless its Approval Type row, set by a System Manager or the instance settings file, says Apply now, review after. A type that grants a role or report access SHALL be Approve first whatever is stored, and setting it otherwise SHALL be refused. A proposal SHALL keep the mode it was made under.

#### Scenario: No setting

- **WHEN** an app proposes a change of a type with no Approval Type row
- **THEN** it waits for approval and the row is unchanged

#### Scenario: A type that grants access

- **WHEN** an administrator sets a type that grants access to Apply now
- **THEN** it is refused, and its proposals still wait for approval

#### Scenario: The setting changes later

- **WHEN** a type is set to Apply now while one of its proposals waits
- **THEN** that proposal still waits and is approved as before

### Requirement: A change applied at once is reviewed afterwards

Under Apply now, proposing SHALL make the change as approving would, dated the day the app names, and SHALL leave the proposal Not yet reviewed, waiting for the same approvers. A reviewer, never the maker, SHALL confirm it, or undo it with a reason. The maker MAY undo their own while it is not yet reviewed, with no reason. A Not yet reviewed proposal SHALL NOT be approved, rejected or withdrawn, and a pending one SHALL NOT be confirmed or undone.

#### Scenario: Applied when asked for

- **WHEN** a person proposes a change of a type that applies at once
- **THEN** the old row ends, the new one starts, and the proposal is Not yet reviewed

#### Scenario: Confirmed

- **WHEN** a reviewer confirms it
- **THEN** it is Confirmed with who and when, and the rows stay as they are

#### Scenario: Two reviewers at once

- **WHEN** two reviewers undo it, or one undoes and one confirms, at the same moment
- **THEN** exactly one of them takes effect

### Requirement: Undo puts the rows back as they were, or refuses

Undoing SHALL restore the end date of the row the change ended, and SHALL end the row it added the day before it started and retire it, keeping its history. It SHALL refuse, changing nothing, when either row has changed since the change applied, when the added row is already out of use, or while a row in use still links to it. The proposal SHALL keep who made it, who reviewed it, when, and why.

#### Scenario: Undone

- **WHEN** a reviewer undoes an applied change with a reason
- **THEN** the old row runs on as before, the added row is out of use, and the proposal is Undone with the reason

#### Scenario: Changed since

- **WHEN** someone has edited the added row since the change applied
- **THEN** undo is refused, naming who changed it and when, and nothing changes

#### Scenario: Still linked

- **WHEN** a row in use links to the row the change added
- **THEN** undo is refused until that row is undone or retired
