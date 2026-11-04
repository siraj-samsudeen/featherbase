## Context

The generic form already renders Choice, Check, text and Reference fields. Only this registry's effective control descriptions depend on another Table's metadata. The #740 checklist is the UI contract; manager authorized its recommended defaults on 03-Nov-2026.

## Goals / Non-Goals

Keep generic form rendering, naming and saving; guide target-dependent editing. Do not redesign layout, linked-row pickers or shared navigation.

## Decisions

- Use the existing hash naming rule, not a new tuple-derived ID. The target remains editable without renaming the record or defining delimiter/collision rules.
- Project effective field metadata and values for this editor, then pass them through the existing FieldControl. Keep stored Value as text; a boolean Check is a presentation projection, not a schema migration. Consume #774's shared maps, never a second production allowlist.
- Keep the saved-target link based on the loaded saved row, not in-flight edits. Existing IDs remain untouched.
- Compose this registry's fallback title in the shared row-title source, not in recents. An explicit configured title column still wins.
- Four label replacements converge only known platform defaults, including #826's Property/Value intermediate defaults. Custom labels and metadata overlays remain authoritative.
- Round 1 correction, explicitly authorized through manager on 03-Nov-2026: one adjustment per Table, empty-normalized column and setting. Refuse duplicate creation or retargeting with guidance to edit the existing record; exclude the record itself on edits. This is a new decision, not a claim about prior behavior. Arbitrary competing values are nondeterministic, while upserting would silently edit another record. No new schema migration is needed.
- A fresh-process concurrent HTTP regression admitted 8 of 8 duplicate creates with validation alone. Serialize Metadata Override writes with a controller-local advisory transaction lock in the existing before-row-lock hook, then check the tuple in validation. This avoids both a check/insert race and retarget lock inversion without a generic constraint layer. These settings writes are infrequent, so serialization is preferable to a tuple-lock protocol.
- Moving an adjustment invalidates both the previous and saved targets, in server metadata and client query caches. Invalidating only the destination leaves previously viewed source metadata stale.

## Risks / Trade-offs

The editor needs an additive FormView seam while local Claude owns #795/#793. Keep changes to dependent-control metadata, state resets and one saved-target link; leave field order and Reference controls unchanged. The actual Table metadata request can fail; disable dependent controls and show the failure rather than accept free text.

## Migration Plan

One ordered SQL migration changes prompt to hash and four known default labels. No row IDs or values are rewritten. Rehearse against a disposable development database and verify custom labels remain. Stack on exact published #774; rebase/retarget main after it lands, without merging either PR here.

## Open Questions

None. Generic label display and arrangement work stay with their respective owners.
