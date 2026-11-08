## Why

A store team member submitting a task or raising an issue in Tasker could not add a photo: an
upload needed access to files in general, which Tasker members don't have, and an app upgrade may
not hand it out. Attaching a photo to a row is part of changing that row, so whoever may change the
row should be able to attach it, and whoever can open the row can open the photo.

## What Changes

- Someone who may change a row can attach a file to it without access to files in general.
- Attaching to a whole table, or to nothing, still needs access to files, as before.
- A refused upload never leaves stored content behind.
- Tasker attaches the evidence photo to its task and the issue photo to its issue.

## Capabilities

### New Capabilities

### Modified Capabilities
- `files-and-sharing`: attaching a file to a row the user may change.

## Impact

The upload service and its tests; Tasker 3.3.1 uploads photos onto their task or issue. No grant
on files is added or widened.
