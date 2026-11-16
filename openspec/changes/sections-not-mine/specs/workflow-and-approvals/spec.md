## ADDED Requirements

### Requirement: The maker can withdraw a pending proposal

The person who made a proposal SHALL be able to withdraw it while it waits, and nobody else SHALL. A withdrawn proposal SHALL change nothing and SHALL no longer wait for anyone.

#### Scenario: The maker withdraws

- **WHEN** the maker withdraws their pending proposal
- **THEN** it shows as withdrawn and no approver sees it

#### Scenario: Too late to withdraw

- **WHEN** the maker withdraws a proposal that was already decided, or someone else tries to withdraw it
- **THEN** it is refused and nothing changes

#### Scenario: An approver decides a request just withdrawn

- **WHEN** an approver decides a proposal the maker has already withdrawn
- **THEN** it is refused with the reason that the person who asked has withdrawn it, and nothing changes

### Requirement: A proposal can end a row

An app SHALL be able to propose ending a row with nothing in its place. Approving SHALL end the row the day before the change takes effect, keeping history, under the same checks as any other change.

#### Scenario: An ending is approved

- **WHEN** an approver approves ending a row
- **THEN** the row ends and no new row is added

### Requirement: An approver can apply something else

An approver SHALL be able to approve a proposal with a different value for a column it changes. The applied row SHALL hold the approver's value and the proposal SHALL say what was done instead.

#### Scenario: Approved with another value

- **WHEN** an approver approves a proposed change but picks another value
- **THEN** the new row holds the approver's value
