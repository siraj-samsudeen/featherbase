## ADDED Requirements

### Requirement: See what this instance is running

A System Manager SHALL see, on the Apps page, the commit the instance was built from, linked to it and to the changes up to it, with that commit's title and when the server started. A build that cannot tell its commit SHALL say so rather than guess. Each app SHALL show what changed in its latest versions, newest first, with each issue reference linked to that issue.

#### Scenario: Check which build an instance runs

- **WHEN** a System Manager opens the Apps page on an instance deployed from commit a1b2c3d
- **THEN** they see commit a1b2c3d linked to that commit, its title with its pull request linked, and when the server started
- **AND** a link to the changes up to that commit

#### Scenario: A build that does not know its commit

- **WHEN** the server was built without being told its commit and has no git checkout
- **THEN** the Apps page says the commit is unknown, with no link

#### Scenario: See what changed in an app

- **WHEN** a System Manager chooses Tasker on the Apps page
- **THEN** they see what changed in Tasker 3.0.2, 3.0.1 and 3.0.0, newest first
- **AND** each issue a change names links to that issue

#### Scenario: Others cannot see it

- **WHEN** a person who is not a System Manager asks for the Apps page's information
- **THEN** it is refused
