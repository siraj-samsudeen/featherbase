# Proposal

## Why

Draft and resubmission states currently email everyone allowed to act, even when no approval is needed. The owner chose explicit approval states in #569 so ordinary work does not send unwanted approval emails.

## What Changes

- **BREAKING**: only states explicitly marked as waiting for approval send approval notifications.
- Add an editable, initially unchecked mark to each workflow state through Table metadata.
- Keep existing recipient exclusions and final-state behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workflow-and-approvals`: approval emails require an explicitly marked state.

## Impact

Platform Workflow state metadata, a converging migration, the shared workflow notifier, and notification tests. The initial-row notifier in held PR #585 will use this same gate; this change does not duplicate that work.
