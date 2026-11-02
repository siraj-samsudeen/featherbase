## Decision: Reuse Table-level Metadata Overrides for optional collaboration

The owner selected “Default collaboration off everywhere, but keep existing content readable” on 02-Nov-2026. Four boolean effective Table properties (`enable_assignments`, `enable_tags`, `enable_files`, `enable_discussion`) default false and use the existing Table-level Metadata Override mechanism to opt in. This reuses persistence, generic editing, customization export and cache invalidation, rather than adding four physical columns plus another configuration API and migration. No content is rewritten. System-written metadata retains its existing override prohibition.

The rejected alternative is physical flags on every Table definition. That would duplicate an existing generic configuration path for UI-only optional features. Flags are not authorization: all underlying server read/write checks stay unchanged. Disabled UI is read-only for existing content, not a new server denial policy. Audit and existing discussion share the existing chronological timeline; the comment component contributes a composer only, not a second copy of discussion.

The UI checklist in #800 owns labels and layout. Field layout and pickers stay outside this change. Existing content queries remain permission-filtered; a failed read is never interpreted as empty authorized content. Internal tab changes keep panel state mounted to retain edits and drafts.

## Display capabilities, not a permission engine

The existing document ownership boundary computes a read-effect `:capabilities` row action only after `getDoc` authorizes access. It reuses operation-specific permission assertions, own-row ownership, Data Scopes, write-share handling and security/source restrictions. The UI uses this advice to hide unavailable operations; mutation endpoints remain authoritative and unchanged. Assignment, File and Comment creation retain their independent grants; tags require only parent-row read. Attachment removal consults the File row's own delete capability. Advice refreshes on row changes, explicit refresh and browser focus; it is not persisted or cached in effective Table metadata.

Baseline `main` FormView has no router blocker or beforeunload handler, and the independent verifier reproduced silent breadcrumb loss on existing/new rows. Checklist 6 preserves existing protection, not a new leave-page policy: that baseline gap is outside #800 and recorded as a suggested fix. Tab navigation must retain unfinished fields and discussion drafts.
