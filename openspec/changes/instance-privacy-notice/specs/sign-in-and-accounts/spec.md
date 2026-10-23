# Sign In and Accounts Delta

## ADDED Requirements

### Requirement: Publish the instance's privacy notice

An administrator SHALL be able to set the instance's own privacy notice, and
anyone SHALL be able to read it on a public page without signing in. Until a
notice is set, the page SHALL not exist. Formatting in the notice, such as
headings, lists and links, SHALL show as formatting; anything that could run
in the reader's browser SHALL be shown as plain text or dropped.

#### Scenario: Read the notice before signing in

- **WHEN** an administrator has set a notice and a visitor who is not signed in opens the privacy page
- **THEN** they see the notice, with its headings and links

#### Scenario: No notice set

- **WHEN** no notice has been set and someone opens the privacy page
- **THEN** they are told the page does not exist
