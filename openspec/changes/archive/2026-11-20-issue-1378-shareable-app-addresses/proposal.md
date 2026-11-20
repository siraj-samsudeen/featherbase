## Why

The owner (20-Nov-2026, #1378): a copied address from Tasker or Tickets should reopen what was on screen. Tasker kept its page and project in memory and put a single task id in a hash, so a subtask's address lost its parent and project. Tickets read `?ticket=` once and never wrote anything back.

## What Changes

- Tasker's address is a path: the page (`/tasker/inbox`, `/tasker/projects/<project>`, `/tasker/views/<view>`, `/tasker/issues/<issue>`, `/tasker/sla-rules`, and so on), then `/tasks/<task>`, then `/subtasks/<subtask>`; a discussion question is `?question=`. Each move is a history entry. The hash addresses are removed.
- Tasker declares record pages for its tasks and projects.
- Tickets' address is `/tickets/`, `/tickets/mine`, `/tickets/assigned`, `/tickets/<view>/<ticket>` and `/tickets/new`, with `?search=`, `?type=` and `?state=`. The record page and the assignment email use `/tickets/all/<ticket>`.
- Both keep the query keys they do not own (the shared bar's).

## Capabilities

### New Capabilities

### Modified Capabilities

- `tasker-use-workspace`: the address names what is open.
- `tickets-workspace`: the address names what is open.

## Impact

- Tasker 3.3.5 and Tickets 0.2.23, each a no-op version step. No server change: the platform already serves an app's page at any path below it.
- Dash still links tickets as `/tickets/?ticket=<id>`; Tickets reads that one form until Dash's next version (Dash is on hold).
