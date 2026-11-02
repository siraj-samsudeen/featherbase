## Why

Row work competes with Table administration and empty collaboration cards. #800 selects purposeful form areas and compact, contextual list actions so users can concentrate on their current task without losing existing tools.

## What Changes

- Keep editing and primary actions prominent; put related navigation, collaboration and activity in distinct form areas. Group occasional record operations.
- Group alternate list views and occasional row operations; separate Table administration and keep bulk actions contextual to selection.
- Preserve field layout, pickers, permissions, confirmations and unsaved edits. Do not incorporate prototype #799 or take over #792–#796, #740 or #773.
- Owner decision, 02-Nov-2026: “Default collaboration off everywhere, but keep existing content readable”. Explicit Table-level enablement independently controls assignment, tags, files and discussion UI; existing and new Tables default off, populated disabled features remain read-only under original access protections, and audit stays accessible. Flags grant no server permission.

## Capabilities

### New Capabilities

- `record-workspace`: distinguish everyday row work from occasional operations and administration without losing edits or existing capabilities.

### Modified Capabilities

Existing row editing, history and list semantics remain in force. Optional collaboration changes UI availability only, as specified in record-workspace.

## Impact

Generic FormView and ListView, shared action disclosure, four effective Table properties using existing Metadata Overrides, and real-stack acceptance and component tests. No permission grants, storage changes or content migration. Merge and deployment remain on hold.
