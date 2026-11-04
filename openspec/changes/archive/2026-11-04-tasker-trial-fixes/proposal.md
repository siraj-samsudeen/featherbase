## Why

The local trial of Tasker 3.0.0 before installing it on staging (#563, task 6.7)
found two defects a person sees at once:

- Activity history showed record ids: `assigned to: empty → psn_cineltf3yzqcrzdq7z5q`,
  `project: empty → TPROJ-0001`.
- A person's own question was marked **Unread** for them straight after they posted
  it, and again after they resolved it, so the Unread marker stopped meaning "someone
  else said something".

## What Changes

- Activity history names the person and the project a change refers to. A person or
  project that is no longer available reads "Former member" or "Project not available",
  never an id.
- Unread marks only messages from someone else. Your own question, reply or resolution
  is never unread for you, on the task or in Needs your attention.
- Tasker 3.0.1, with an empty 3.0.0 → 3.0.1 migration: no data changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `tasker-use-task-details`: history values read as names.
- `tasker-discussions`: unread excludes the reader's own activity.

## Impact

The Tasker app only (client code and its version). No schema or data change.
