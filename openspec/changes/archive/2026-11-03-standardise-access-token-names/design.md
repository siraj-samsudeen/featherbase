## Context

#853's six-point checklist and owner-approved direction A govern the UI. Display labels are already separate from opaque identities and token hashes. Existing HTTP routes guard principal ownership and System Manager access; the generic row API refuses service-account writes.

## Goals / Non-Goals

Make credentials recognisable and editable without replacing them. No access/expiry-policy changes, migrations, role editing, command discovery or pagination.

## Decisions

- Keep name-only mutations in auth and service-accounts, behind the existing route guards. Token rename uses PATCH with a label; service-account PATCH accepts exactly one of label or enabled so a rename cannot accidentally toggle the account. Reject mixed writes rather than partially applying them. Existing role replacement stays separate.
- The editable label suggestion is client-local: owner display name plus count of all that owner's tokens plus one. A server counter would turn a convenience into identity allocation, adding unnecessary schema and concurrency requirements. Labels need not be unique. Track user editing explicitly, including clearing, rather than comparing text to an old suggestion.
- Use DataList and the existing platform button/field/card/notice recipes. There is no generic dialog or desktop tabs component in this revision; consolidate this page's dialogs around one focus-managed wrapper rather than introducing another UI framework.

## Risks / Trade-offs

Concurrent issuance may suggest the same label; names are editable non-unique labels, never IDs. Uniqueness for service-account names continues to be decided by the existing database index, with conflicts surfaced in the dialog.

## Migration Plan

No schema or data migration. Reverting the code leaves names and credentials intact.

## Open Questions

None within the approved checklist. Yellow rating remains proposed, not ratified. Ordinary hidden-logic review and merge remain manager/owner gates.
