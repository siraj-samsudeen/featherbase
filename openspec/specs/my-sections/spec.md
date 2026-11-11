# my-sections Specification

## Purpose
A person who signs in to Dash can see what is mapped to them and say when it is wrong. Their correction goes to their manager, and nothing changes until it is approved.

## Requirements

### Requirement: A person sees what is mapped to them

Dash SHALL show a signed-in person their name, their job, their store and who they report to, and each section they hold with its floor and its subcategories, by name, never by code.

#### Scenario: A team leader sees their section

- **WHEN** a team leader whose job is in Ladies Wear at Lakeside opens Your sections
- **THEN** they see their name, job, Lakeside and their manager's name
- **AND** Ladies Wear with its floor and its subcategories, by name

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

A person SHALL be able to propose moving a subcategory of a section they hold to another section in the same store, adding a subcategory to a section they hold, and changing the section on their own job to another in the same store. A proposal SHALL change nothing, and SHALL show who it waits for and then its outcome.

#### Scenario: A subcategory that isn't theirs

- **WHEN** a person says Sarees is not in their section and picks Silk in the same store
- **THEN** the page shows the proposal waiting for their manager
- **AND** Sarees is still in their section

#### Scenario: A missing subcategory

- **WHEN** a person searches the store's subcategories and asks to add one
- **THEN** the page shows the proposal waiting for their manager and where the subcategory is now

#### Scenario: Their section is wrong

- **WHEN** a person picks the correct section for their job
- **THEN** the page shows the proposal waiting for their manager
- **AND** their job keeps its section

#### Scenario: Outside what they hold

- **WHEN** a request names a section the person doesn't hold now, a section in another store, or a section no longer active
- **THEN** it is refused and nothing is recorded

### Requirement: An approver decides

Dash SHALL list for a person the proposals waiting for them, each showing who asked, what it is, and from and to. They SHALL be able to approve, or to reject with a reason. The person's manager SHALL approve; with no manager, or a manager who can't sign in yet, a person holding Master Data Editor SHALL. Nobody SHALL approve their own proposal, whatever roles they hold.

#### Scenario: A manager approves

- **WHEN** a manager approves moving Sarees to Silk
- **THEN** the old placement has ended, a new dated one is in Silk, and the person sees Approved

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

### Requirement: Dash's empty screens lead to the fix

Dash's empty report screens SHALL link to Your sections, and its sidebar SHALL offer Your sections always and Waiting for your approval when something waits.

#### Scenario: No sections yet

- **WHEN** a person's store has no sections set up, or they have no access to any store's report
- **THEN** the screen offers a link to Your sections

### Requirement: Your sections changes can apply at once

Where an instance sets Your sections' approval types to Apply now, a person's Not mine, addition or section change SHALL take effect at once and SHALL show as not yet reviewed, naming who will review it, with an Undo. The page SHALL say that changes happen at once only when every kind does. What a person reaches in reports SHALL follow at once, and an undone addition SHALL reach them no more.

#### Scenario: Not mine at once

- **WHEN** a team leader says Sarees is not in their section, and removals apply at once
- **THEN** Sarees is out of their section, shown struck through as not yet reviewed with an Undo, and their manager sees it to confirm or undo

### Requirement: The reviewer confirms or undoes what was done at once

The reviewer SHALL see changes already made apart from what waits for approval, and SHALL confirm each or undo it with a reason. Undoing a removal SHALL be refused when the subcategory has since been put in another section.

#### Scenario: Undone by the manager

- **WHEN** the manager undoes it with a reason
- **THEN** Sarees is back in their section and the team leader reads the reason

#### Scenario: Put elsewhere since

- **WHEN** Sarees has been added to another section after it was taken out
- **THEN** undoing the removal is refused, saying where it is now
