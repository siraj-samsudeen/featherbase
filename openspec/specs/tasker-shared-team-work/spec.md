# Shared Team Work

## Purpose

Tasker gives admitted members shared projects and team work alongside
creator-only personal tasks. Responsibility identifies who is doing shared
work; access to personal work belongs only to its creator.

## Requirements

### Requirement: Everyone can work on everything

Every signed-in Tasker member SHALL be able to see, create and change shared projects and tasks regardless of responsibility. Personal work SHALL be accessible only to its creator, and each person's shortlist, starred projects and saved searches SHALL remain private.

#### Scenario: Help with a task nobody has taken

- **WHEN** the user, a Tasker member, marks an unassigned shared task urgent and adds a comment
- **THEN** the team sees both changes and the task remains unassigned

### Requirement: A newer change is never overwritten

If two people change the same task and one saves first, the other's save SHALL
be refused rather than silently overwriting the newer change.

#### Scenario: Two people edit the same task

- **WHEN** Siraj and Shahul both have the same task open, Shahul saves a change, and Siraj then saves his
- **THEN** Siraj is told the task has changed
- **AND** Shahul's change stays

### Requirement: Membership is explicit

Tasker SHALL admit only people explicitly granted membership; signing into Featherbase alone SHALL NOT give access to its work. Removing membership SHALL refuse subsequent access without deleting the work.

Tasker membership alone SHALL NOT grant entry to Featherbase's platform workspace.

#### Scenario: Membership opens only the app

- **WHEN** a person with Tasker membership and no platform workspace grant signs in
- **THEN** Tasker is available and Featherbase is not offered as a destination
- **AND** a direct request to open the platform workspace is refused

#### Scenario: Membership is removed

- **WHEN** the user's membership is removed while a task is open
- **THEN** the next request to read or change it is refused

### Requirement: Personal work is creator-only

Only the creator SHALL see or change personal tasks and their subtasks, discussion, history and attachments, even when another person is an administrator. Other people's lists, searches and counts SHALL NOT reveal that work.

#### Scenario: An administrator follows a private link

- **WHEN** an administrator who did not create a private task follows its link or requests its discussion or attachment
- **THEN** access is refused without revealing the private content

### Requirement: Sharing is deliberate and permanent

Moving a personal task into a shared project SHALL immediately share its description, subtasks, discussion and history with Tasker members, without an extra confirmation. Once shared, the task SHALL NOT become private again.

#### Scenario: Share personal work

- **WHEN** the user moves their private task into a shared project
- **THEN** members can see it and its existing contents immediately
- **AND** moving it back to a private list is refused
