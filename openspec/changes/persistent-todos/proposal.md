## Why

People need a to-do list they can rely on: what they add must still be there tomorrow, after the
app restarts. This is the first slice of the Featherbase rewrite and proves the build process on
a small, familiar feature.

## What Changes

- An HTTP API to create a to-do and to list to-dos.
- To-dos are stored durably, so they survive a restart.

## Capabilities

### New Capabilities
- `todos`: create to-dos and list them; the list survives a restart.

### Modified Capabilities

## Impact

- New Bun + Elysia API service (the first code on this branch).
- New SQLite file for storage.
