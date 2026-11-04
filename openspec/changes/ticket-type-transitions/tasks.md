# Tasks: ticket type transitions

## 1. Runtime knows the caller's roles

- [x] 1.1 Server test: an app action and read are told the caller's own roles — red → add `roles` to the runtime context → green.

## 2. Transitions in Tickets

- [x] 2.1 Server tests (synthetic rows): a type's transitions are validated; only listed moves are offered and accepted; `allowed` assignee / requester / any / role; required action fields; direct state change, resolve and reopen refused for a type with transitions; a type without transitions unchanged; history and public progress — red → implement in the Tickets server → green.
- [x] 2.2 Tickets 0.2.0: manifest migration adds the `transitions` column; version bumped everywhere it is pinned.
- [x] 2.3 Ticket page: action buttons with their fields; action fields left off the new-ticket form.

- [x] 2.4 Details visible to everyone (default) or private, per type (Siraj, 04-Nov-2026): open Tables for open types; built-in types stay private; tests for both and reassignment. The private assignee / raised-for reader is #925.

## 3. Acceptance

- [x] 3.1 Step definitions for the change's scenarios; the effective acceptance suite passes for them.
- [x] 3.2 Browser check of the ticket page's actions (headless).

## 4. Close

- [ ] 4.1 Codex review; fix blockers, file the rest.
- [ ] 4.2 Sync specs and archive the change as the branch's last commit.
