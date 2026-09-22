## Context

File uses ref_table/ref_name (0005_core_seeds); Share uses share_table/share_name
(0009_docshare). Generic creates, updates and upload all use saveDoc. Upload's
early target authorization precedes storage writes; saveDoc must recheck under
the target lock. File bytes are outside PostgreSQL; this change governs links,
not external-storage atomicity. No other core document-link family was found.

## Decisions

Extend retainedDocumentCounts with files/shares, matching both target columns.
Return numeric counts from deletionState and string-valued error fields from
raw/action deletion. This is additive; existing ledger results replay unchanged.

Extend the existing target guard to File and Share. Runtime document pointers
require target read permission and current lifecycle availability after acquiring
FOR KEY SHARE in the save transaction. Updates lock both old and new targets.
The enclosing appOperation admission excludes lifecycle transitions. File rows
without a document target (unattached or table-level) do not acquire a row lock
and do not count against a particular row. Existing nonruntime paths stay intact.

The target row's FOR UPDATE deletion lock makes both race orders safe: a link
committing first prevents deletion; deletion committing first rejects the link.
No new privilege is granted to actions (File/Share helpers remain unsupported).

## Non-Goals

Arbitrary application soft pointers, external storage cleanup redesign, removal
of retained links, privilege escalation and Tasker-specific retained-work policy.

## Proof

Asymmetric Admin File/Share creation, exact target pairs, moves, raw/action delete,
rollback, replay/restart, disabled targets and independent-connection race orders.
Use only the existing worker-owned test databases; no shared migrations/writes.
