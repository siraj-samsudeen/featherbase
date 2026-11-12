## MODIFIED Requirements

### Requirement: A person sees what is mapped to them

Dash SHALL show a signed-in person their name, their job, their store and who they report to, and each section they hold with its floor and its subcategories, by name, never by code. Each subcategory's division, sub-division and category SHALL show: once, when the section's subcategories all share them, otherwise as groups, so two subcategories with the same name are told apart.

#### Scenario: A team leader sees their section

- **WHEN** a team leader whose job is in Ladies Wear at Lakeside opens Your sections
- **THEN** they see their name, job, Lakeside and their manager's name
- **AND** Ladies Wear with its floor and its subcategories, by name, under their division, sub-division and category

#### Scenario: A section that mixes categories

- **WHEN** a section holds subcategories of two categories
- **THEN** they show in two groups, each under its division, sub-division and category

#### Scenario: A job with no section

- **WHEN** a person's job has no section against it
- **THEN** the page says no section is set against their job and offers to say which is theirs

#### Scenario: Someone the staff list doesn't know

- **WHEN** a signed-in person is on no current staff row
- **THEN** the page says the staff list doesn't know them yet and to ask their manager

#### Scenario: A store with no sections

- **WHEN** a person's store has no sections
- **THEN** the page says this store has no sections set up yet and to tell their manager

### Requirement: A person proposes a correction

A person SHALL be able to propose taking a subcategory out of a section they hold, without saying where it goes; adding subcategories to a section they hold, several at once, found by division, sub-division and category, each showing where it is now; and changing the section on their own job to another in the same store. A proposal SHALL change nothing, SHALL show who it waits for and then its outcome, and SHALL be withdrawn at once if they undo it before it is decided.

#### Scenario: A subcategory that isn't theirs

- **WHEN** a person says Sarees is not in their section
- **THEN** Sarees shows crossed out, waiting for their manager to approve the removal
- **AND** Sarees is still in their section

#### Scenario: A missing subcategory

- **WHEN** a person browses to their category and asks to add two subcategories, one in no section and one in another section
- **THEN** both show as additions waiting for approval, and each said beforehand where it was and who held it

#### Scenario: Undo

- **WHEN** a person undoes a pending removal
- **THEN** the subcategory shows as theirs again and nothing waits for their manager

#### Scenario: Their section is wrong

- **WHEN** a person picks the correct section for their job
- **THEN** the page shows the proposal waiting for their manager
- **AND** their job keeps its section

#### Scenario: Outside what they hold

- **WHEN** a request names a section the person doesn't hold now, a section in another store, or a section no longer active
- **THEN** it is refused and nothing is recorded

### Requirement: An approver decides

Dash SHALL list for a person the proposals waiting for them, each showing who asked, what it is, its division, sub-division and category, and from and to. They SHALL be able to approve, or to reject with a reason. The person's manager SHALL approve; with no manager, or a manager who can't sign in yet, a person holding Master Data Editor SHALL. Taking a subcategory from another section SHALL show as a move, from that section and its Team Leader to the person's, and SHALL wait for either Team Leader's manager; the approver MAY put it in another section instead. Nobody SHALL approve their own proposal, whatever roles they hold.

#### Scenario: A manager approves

- **WHEN** a manager approves taking Sarees out of Ladies Wear
- **THEN** Sarees is in no section at Lakeside and the person sees Approved

#### Scenario: A move between two team leaders

- **WHEN** a team leader asks to add Silk Sarees, which another team leader with a different manager holds
- **THEN** both managers see it as a move, and either one's decision settles it

#### Scenario: Moved somewhere else

- **WHEN** an approver puts an asked-for subcategory in a third section instead
- **THEN** it is in that section and the person sees what was done

#### Scenario: A rejection needs a reason

- **WHEN** a manager rejects without a reason
- **THEN** the rejection is refused and the proposal still waits
- **WHEN** they give a reason
- **THEN** nothing changes and the person sees Rejected with that reason

#### Scenario: A manager with no sign-in

- **WHEN** a person's manager has no sign-in yet
- **THEN** the proposal waits for the master data team
- **AND** anyone holding Master Data Editor sees it, except the person who asked

#### Scenario: Someone who isn't the approver

- **WHEN** someone who is not the approver asks to decide, a System Manager included
- **THEN** it is refused and nothing changes

#### Scenario: A row that changed meanwhile

- **WHEN** a manager approves a proposal whose row changed since it was made, or whose destination section is no longer active
- **THEN** nothing changes and the person sees that it needs asking again

#### Scenario: Nothing waiting

- **WHEN** nothing waits for a person
- **THEN** the page says so plainly

## ADDED Requirements

### Requirement: The master data team sees what is in no section

Dash SHALL list for people holding Master Data Editor each subcategory that was in a section at a store and is now in none there, until someone puts it in a section.

#### Scenario: A removal leaves it unplaced

- **WHEN** a removal of Sarees at Lakeside is approved
- **THEN** the master data team's list shows Sarees at Lakeside, and it leaves the list once it is added to a section
