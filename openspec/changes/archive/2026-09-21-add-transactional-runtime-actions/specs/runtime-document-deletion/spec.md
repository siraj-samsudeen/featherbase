## MODIFIED Requirements

### Requirement: runtime_row_delete_guard
Status: governed (#296)

Every generic runtime-owned row deletion SHALL require caller delete permission,
the exact loaded revision, zero comments, zero recorded update Versions and zero
incoming declared References. Refusal SHALL preserve the source and its activity.
The raw document endpoint SHALL NOT bypass the same host retention guard exposed
to declared actions. The host SHALL return counts without exposing hidden activity
contents. App-specific retained-work states remain app policy.

#### Scenario: native_delete_ignores_revision_and_discussion
- **WHEN** an authorized caller deletes a runtime row with a stale expected
  revision and one comment
- **THEN** the deletion conflicts and both source and comment remain unchanged

#### Scenario: correct_revision_still_preserves_discussion
- **WHEN** an authorized caller uses the current revision to delete a runtime row
  with recorded discussion or history
- **THEN** the deletion refuses with activity counts and preserves every row

#### Scenario: bare_row_can_be_deleted
- **WHEN** an authorized caller supplies the current revision for an unreferenced
  runtime row without discussion or recorded updates
- **THEN** the generic API deletes that row
