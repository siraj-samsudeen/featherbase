## ADDED Requirements

### Requirement: Created to-dos are listed
Feature: To-do list
Rule: Every to-do a person creates SHALL appear in their list, not done, in the order created.

#### Scenario: A new to-do is listed, not done
- **GIVEN** a person has no to-dos
- **WHEN** the person creates the to-do "Buy milk"
- **THEN** their list shows "Buy milk", not done

#### Scenario: To-dos are listed in the order they were created
- **GIVEN** a person has created "Buy milk" and then "Pay rent"
- **WHEN** the person lists their to-dos
- **THEN** the list shows "Buy milk" first and "Pay rent" second

### Requirement: A to-do can be marked done or not done
Rule: A person SHALL be able to mark a to-do done, and mark a done to-do not done again.

#### Scenario: Marking a to-do done
- **GIVEN** a person has the to-do "Buy milk", not done
- **WHEN** the person marks "Buy milk" done
- **THEN** their list shows "Buy milk", done

#### Scenario: Marking a done to-do not done again
- **GIVEN** a person has the to-do "Buy milk", done
- **WHEN** the person marks "Buy milk" not done
- **THEN** their list shows "Buy milk", not done

### Requirement: A to-do can be renamed
Rule: A person SHALL be able to change a to-do's title; it keeps its place in the list.

#### Scenario: Renaming a to-do
- **GIVEN** a person has created "Buy milk" and then "Pay rent"
- **WHEN** the person renames "Buy milk" to "Buy oat milk"
- **THEN** the list shows "Buy oat milk" first and "Pay rent" second

### Requirement: A to-do can be deleted
Rule: A person SHALL be able to delete a to-do; it no longer appears in their list.

#### Scenario: Deleting a to-do
- **GIVEN** a person has created "Buy milk" and then "Pay rent"
- **WHEN** the person deletes "Buy milk"
- **THEN** the list shows only "Pay rent"

### Requirement: The list survives a restart
Rule: Every create, mark, rename and delete SHALL still be in effect after the app restarts.

#### Scenario: Changes made before a restart are listed after it
- **GIVEN** a person has created "Buy milk", "Pay rent" and "Call mum"
- **AND** has marked "Buy milk" done, renamed "Pay rent" to "Pay rent and gas" and deleted "Call mum"
- **WHEN** the app restarts and the person lists their to-dos
- **THEN** the list shows "Buy milk", done, then "Pay rent and gas", not done
