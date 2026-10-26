# Proposal

## Why

A project rename can silently overwrite a teammate's newer name if Tasker refreshes while the user is editing (#315). Renaming must protect the teammate's saved work and explain why the older edit cannot be saved.

## What Changes

- Keep a rename tied to the project version the user began editing, even after a refresh.
- Preserve the typed name when fresh project data arrives or a save conflicts.
- Prove that a competing rename followed by a refresh cannot be overwritten.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `tasker-reorganize-projects`: make the existing newer-change protection explicit for refreshes during editing, with an explanation and retained draft.

## Impact

Tasker's project heading and rename callback in `runtime-apps/tasker/src/TaskManagement.tsx`, its real-server component tests, and scoped browser verification. No server contract, dependency, Admin UI, toolbar, or authentication changes.
