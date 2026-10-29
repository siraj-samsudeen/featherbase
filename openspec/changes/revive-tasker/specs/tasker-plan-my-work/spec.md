## MODIFIED Requirements

### Requirement: My Work shows each task once

Among the user's tasks, My Work SHALL show their private shortlist first, followed by other tasks they are responsible for. A task in both groups SHALL appear only once, in the shortlist; conversations needing attention are shown before these task groups.

#### Scenario: A focused task I am responsible for

- **WHEN** the user stars a task they are already responsible for
- **THEN** the task appears once in their shortlist, not again in other assigned work

## ADDED Requirements

### Requirement: Start with work needing attention

Opening Tasker without a specific destination SHALL open the user's work, with conversations needing their reply or review first, followed by their private shortlist and other assigned work. Explicit links to tasks and projects SHALL keep their intended destination.

#### Scenario: Start the day

- **WHEN** the user opens Tasker with one question addressed to them and a reply to their own question
- **THEN** both conversations are shown before their task lists
- **AND** their shortlist comes before the other tasks assigned to them

#### Scenario: Follow a task link

- **WHEN** the user follows a link to a task they can access
- **THEN** that task opens instead of the default workspace
