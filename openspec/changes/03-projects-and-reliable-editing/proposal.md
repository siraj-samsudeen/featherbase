# Organize work into Projects

## Why

A flat list becomes hard to manage as work grows. People need Projects, completion filters, and editing that does not lose their work when another person changes a task or a connection fails.

## What Changes

- Manage Projects and assign or move Todos between them.
- Complete and reopen Todos; filter by Project and completion.
- Validate titles, reject stale changes and support safe recovery from failed or uncertain saves.
- Preserve data during database outages and application restarts.

## Capabilities

### New Capabilities
- `project-work`: Project organization, completion and title rules.
- `reliable-editing`: Concurrency, retry, recovery and durable operation.

### Modified Capabilities
None; the new capabilities add constraints and operations to existing Todos.

## Impact

Depends on `02-task-priority-and-contracts`. Existing Todos become open and unassigned. Scheduling, accounts, membership and permissions are outside this release.
