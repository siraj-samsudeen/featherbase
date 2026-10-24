## MODIFIED Requirements

### Requirement: A team view shows changes, not views

A System Manager SHALL be able to switch the activity trail to a team view,
which shows everyone's changes and sign-ins but never what a colleague
merely looked at. Each row SHALL name the person and show their main role
(System Manager if they hold it, otherwise another role they hold; nothing
for someone with no role), and SHALL NOT show an opaque id or an email address.

#### Scenario: The team view stays to changes, not views

- **WHEN** a System Manager switches to the team view
- **THEN** they see who changed what and who signed in, but not what anyone
  merely looked at

#### Scenario: Rows name the person and their role

- **WHEN** a System Manager opens the team view and a colleague with the
  System Manager role has made a change
- **THEN** the row shows that colleague's name followed by "System Manager"

#### Scenario: A person with no name still reads as a person

- **WHEN** a colleague has no full name on record
- **THEN** the row shows the part of their email before the "@", never the
  whole address or an internal id
