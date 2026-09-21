# Runtime Document Deletion

## Purpose

Characterizes the generic runtime-row deletion path before closing its bypass
around declared guarded actions. This baseline records a defect, not approval.

## Requirements

### Requirement: runtime_row_delete_guard
Status: characterized (#296)

The generic native runtime-row delete path SHALL check caller delete permission
and declared incoming References, but SHALL ignore `expectUpdatedAt` and SHALL
leave Comment/Version soft-reference rows in place after deleting their source.
This is recovered behavior to be superseded, not a safe deletion policy.

#### Scenario: native_delete_ignores_revision_and_discussion
- **WHEN** an authorized caller deletes a runtime row with a stale expected
  revision and one comment
- **THEN** the source disappears and the comment remains pointing to its old ID
