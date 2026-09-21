## MODIFIED Requirements

### Requirement: task_activity_stays_in_tasker
Status: governed (#296) · specified but unbuilt for correction/deletion additions

> evidence: gap — existing task_detail_flow covers activity; correction/deletion proof is pending.

Task details SHALL show description, append-only comments and chronological field history with actor and time. Inspector and focused modes SHALL let a member correct task title and plain/Markdown description, Save or Cancel the draft. Compact mode SHALL provide an explicit path to editing. Empty description SHALL be valid; blank title SHALL not save. Saving SHALL use the version at draft start, surface a conflict without losing the draft, and refresh every task-bearing view without reloading. Switching selected task SHALL not carry another task's draft.

Deletion SHALL require explicit confirmation explaining permanent removal versus Cancelled for retained work. It SHALL preserve comments/history/references by refusing unsafe removal, reject a stale version and close or explain a deleted selected task. Private focus SHALL ignore removed IDs. Until the generic host can enforce those conditions atomically, deletion SHALL remain unavailable rather than promise client-only safety.

#### Scenario: comment_and_edit_are_visible
- **WHEN** a member adds a comment and changes a shared task field
- **THEN** Tasker shows both events with their actor and time.

#### Scenario: correct_title_and_description
- **WHEN** a member saves a changed title and an empty description
- **THEN** both persist and the task list shows the new title without a reload.

#### Scenario: cancel_or_conflict_preserves_work
- **WHEN** a member cancels a draft
- **THEN** no write occurs
- **AND** a competing change after draft start causes Save to report conflict without overwriting it.

#### Scenario: retained_work_is_not_silently_deleted
- **WHEN** a task has discussion, meaningful history or references
- **THEN** Delete does not silently discard that work and explains Cancelled as the retained-work option.
