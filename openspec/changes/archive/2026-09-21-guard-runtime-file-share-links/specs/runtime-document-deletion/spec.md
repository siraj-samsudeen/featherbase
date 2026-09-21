## MODIFIED Requirements

### Requirement: runtime_row_delete_guard
Status: governed (#296)

Every generic runtime-owned row deletion SHALL require caller delete permission,
the exact loaded revision, zero comments, zero recorded update Versions, zero
incoming declared References, zero core File attachments and zero core Share
links targeting that row. Refusal SHALL preserve the source and its activity.
The raw document endpoint SHALL NOT bypass the same host retention guard exposed
to declared actions. The host SHALL return counts without exposing hidden link
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
  runtime row without discussion, recorded updates, File attachments or Share links
- **THEN** the generic API deletes that row

## ADDED Requirements

### Requirement: core_document_links_serialize_with_runtime_deletion
Status: governed (#296)

Core File attachment and Share link creates or target changes SHALL check runtime
target availability and caller read access and serialize with target deletion.
Missing runtime targets SHALL be refused. Updates SHALL protect both old and new
targets. Unattached files, table-level attachments and links to other target pairs
SHALL NOT count against the row being deleted. These guarantees cover supported
host APIs, not direct administrative SQL or arbitrary application soft pointers.

#### Scenario: core_link_creation_races_runtime_deletion
- **WHEN** Admin File or Share creation races deletion of its runtime target
- **THEN** either the link commits first and deletion refuses, or deletion commits
  first and link creation refuses without leaving a dangling document link

#### Scenario: runtime_link_moves_preserve_both_targets
- **WHEN** a caller changes an existing File or Share target
- **THEN** both targets are protected until commit and a missing or disabled new
  runtime target refuses the change without modifying the existing link
