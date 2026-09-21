## MODIFIED Requirements

### Requirement: guarded_action_deletion_preserves_retained_work
Status: governed (#296)

Action helpers SHALL expose document-authorized counts of comments, recorded
update Versions, declared incoming References, core File attachments and core
Share links under the source row lock. Counts SHALL use numeric comments,
versions, references, files and shares fields; deletion refusals SHALL expose
the same names with string values. Action deletion SHALL require an exact loaded
revision and SHALL refuse nonzero counts without deleting the source or links.
Runtime-target Comment, Version, File, Share and declared Reference writes SHALL
serialize with that source lock and SHALL reject a missing target. Apps MAY return
explanatory refusal results without a platform-specific retained-work status policy.
Previously committed replay results SHALL remain unchanged by additive count fields.

#### Scenario: action_delete_races_comment_or_reference_creation
- **WHEN** guarded deletion races a writer linking to the same runtime row
- **THEN** either the link commits first and deletion refuses, or deletion commits
  first and the writer refuses; no orphan link survives

#### Scenario: app_returns_retained_work_refusal
- **WHEN** a readable source has two comments or one recorded update
- **THEN** the helper reports those counts and the app can return an explanatory
  result while source and discussion remain unchanged

#### Scenario: core_attachment_and_share_refusal_replays
- **WHEN** an action explains refusal for a source with two File attachments and
  one Share link, then its committed request is retried after restart
- **THEN** files=2 and shares=1 remain in the original result and no source or link
  is deleted; a thrown command leaves no partial write or consumed retry key
