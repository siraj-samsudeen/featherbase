## MODIFIED Requirements

### Requirement: Everyone can work on everything

Every signed-in Tasker member SHALL be able to see, create and change every project and task, whether or not they are responsible for it; a personal task identifies responsibility and is still shared with the team. Each person's own settings, such as a private shortlist, starred projects and saved searches, SHALL stay private to them.

#### Scenario: Help with a task nobody has taken

- **WHEN** the user, a Tasker member, marks urgent a task nobody is responsible for and adds a comment
- **THEN** both changes are saved and all Tasker members see them
- **AND** nobody is responsible for the task yet

#### Scenario: Help with another member's personal task

- **WHEN** the user, a Tasker member, opens another member's personal task and adds a comment
- **THEN** the comment is saved and visible to the team
- **AND** responsibility remains with the other member

## ADDED Requirements

### Requirement: Membership is explicit

Tasker SHALL admit only people explicitly granted membership by an administrator; signing into Featherbase alone SHALL NOT give access to its tasks, projects or their discussion and history.

#### Scenario: A signed-in person without membership

- **WHEN** the user signs into Featherbase without Tasker membership and follows a link to a task or requests its discussion directly
- **THEN** Tasker refuses access without showing the task or its discussion

#### Scenario: Membership is removed during a session

- **WHEN** an administrator removes the user's Tasker membership while a task is open
- **THEN** the user's next attempt to read or change Tasker work is refused
- **AND** the team's existing work is preserved
