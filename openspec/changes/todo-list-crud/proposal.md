## Why

People need a to-do list they can rely on: what they add, tick off, rename or remove must still be
that way after the app restarts. This is the first feature of the Featherbase rewrite on Bun +
Elysia, scoped to the happy path so the core of Elysia can be learned without error handling
mixed in.

## What Changes

- An HTTP JSON API (no UI) for to-dos, each `{ id, title, done }`:
  - create a to-do from a title (new to-dos are not done);
  - list all to-dos, in creation order;
  - mark a to-do done or not done;
  - rename a to-do;
  - delete a to-do.
- To-dos persist in a local file whose path is configurable, so a new app instance opened on the
  same file sees what an earlier instance wrote — the list survives a restart.

### Non-goals

- **Invalid input and unknown ids are unspecified in this change** (empty or missing titles,
  ids that do not exist). They are handled in a follow-up change, `todo-list-validation`, which
  is also where Elysia's request validation is introduced. Until then no request schema is
  declared, so no untested validation arrives.
- Get-by-id, bulk operations, filtering or sorting options, due dates, priorities.
- Users, authentication, a UI.

## Capabilities

### New Capabilities
- `todos`: create, list, mark done/not done, rename and delete to-dos over HTTP; the list
  survives a restart.

### Modified Capabilities

None — `openspec/specs/` is empty; this is the first capability.

## Impact

- New Bun + Elysia API service — the first code on this branch.
- New local SQLite file for storage (built-in `bun:sqlite`; the choice is recorded in design/ADR).
