## Why

Live testing exposed missing task correction, project context and task-to-project promotion. Accidental tasks need explicit safe removal; retained work needs Cancelled instead.

## What Changes

- Correct title and description within task details, with draft cancellation and stale-write rejection.
- Shared, safely rendered project Markdown descriptions.
- Atomic, retry-safe promotion that preserves work history.
- Safe accidental-task deletion, conditional on a generic host contract that protects history and concurrent changes.
- Development-only Test Drive feedback template.

## Capabilities

### New Capabilities
- `tasker-project-descriptions`: shared project Markdown context.
- `tasker-promote-task`: promote simple tasks or preserve rich tasks inside a new project.

### Modified Capabilities
- `tasker-use-task-details`: correction and accidental-task removal.

## Impact

Tasker package, component/server tests and literal package proof. No production seed, per-app core endpoints, trash, subtasks or additional project-management concepts.
