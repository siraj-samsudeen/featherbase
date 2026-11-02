## Why

Row work competes with Table administration and empty collaboration cards. #800 selects purposeful form areas and compact, contextual list actions so users can concentrate on their current task without losing existing tools.

## What Changes

- Keep editing and primary actions prominent; put related navigation, collaboration and activity in distinct form areas. Group occasional record operations.
- Group alternate list views and occasional row operations; separate Table administration and keep bulk actions contextual to selection.
- Preserve field layout, pickers, permissions, confirmations and unsaved edits. Do not incorporate prototype #799 or take over #792–#796, #740 or #773.
- Collaboration stays available under existing permissions during the separable chrome phase. Explicit enablement, defaults and migration remain gated on the owner decision relayed by the manager; this proposal does not authorize them.

## Capabilities

### New Capabilities

- `record-workspace`: distinguish everyday row work from occasional operations and administration without losing edits or existing capabilities.

### Modified Capabilities

None in the separable chrome phase. Existing row editing, history and list behavior remain in force.

## Impact

Generic FormView and ListView, shared action disclosure, and real-stack acceptance and component tests. No server API, permission, storage or metadata changes in this phase. Merge and deployment remain on hold.
