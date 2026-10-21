# todos Specification

## Purpose
TBD - created by archiving change persistent-todos. Update Purpose after archive.

## Requirements

### Requirement: Created to-dos are listed
Feature: To-do list
Rule: Every to-do a person creates SHALL appear in their list, in the order created, and SHALL
still be there after the app restarts.

#### Scenario: A created to-do is listed after a restart
- **GIVEN** a person has created the to-do "Buy milk"
- **WHEN** the app restarts and the person lists their to-dos
- **THEN** the list contains "Buy milk", not done

#### Scenario: To-dos are listed in the order they were created
- **GIVEN** a person has created "Buy milk" and then "Pay rent"
- **WHEN** the person lists their to-dos
- **THEN** the list shows "Buy milk" first and "Pay rent" second

### Requirement: A to-do needs a title
Feature: To-do list
Rule: The system SHALL reject a to-do created without a title, and SHALL NOT store it.

#### Scenario: A to-do without a title is rejected
- **GIVEN** a person has no to-dos
- **WHEN** the person creates a to-do without a title
- **THEN** the request is rejected and the list stays empty
