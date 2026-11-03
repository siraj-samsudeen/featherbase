## Context

The generic FormView renders metadata columns as controls; no reading presentation seam exists. Email Sink stores plain text (`email.ts` sends the same value as SMTP text), a comma-joined list of attachment names and only the first attachment payload. Owner defaults authorize the smallest coherent design without an approval pause.

## Goals / Non-Goals

Read messages comfortably using the generic form and existing read permissions. No specialized Table form, endpoint, HTML parser, sending controls, downloads or collaboration-policy rewrite.

## Decisions

1. Add one nullable `reading_presentation` JSON metadata value with a fixed schema: title, headers, body and optional attachment-names column roles, plus an optional configured notice. Reuse existing column labels, translations and value formatting. A per-model renderer violates the platform invariant; a full layout DSL or multiple modes is unnecessary.
2. Only existing read-only rows use this reading presentation. Writable/new rows keep their ordinary editable form. Raw controls and unchanged secondary record context sit under a closed disclosure, so system-written protections stay intact and unrelated empty collaboration cards do not distract from the message.
3. Render text through React escaping and pre-wrap/overflow-wrap, not sanitized HTML or an iframe. There is no stored rich content contract to justify parsing. Attachment names are displayed as the stored list, never split into fictional individual downloadable files.
4. Leave metadata override allowlists alone: use physical Table metadata, validated through the existing Table definition contract. System-written Table metadata remains platform-owned. #800 owns collaboration suppression and will be reconciled at its integration gate, not duplicated here.

## Risks / Trade-offs

- Unmerged #800 changes FormView extensively → keep the reading component isolated and record the integration gate.
- No attachment download → honest representation of current storage; avoids implying multiple payloads exist.
- Plain-text markup is literal → safe and faithful to current email transport.

## Migration Plan

Add nullable metadata to table_def, expose it through validated Table definitions (not an unvalidated generic JSON control), and configure Email Sink with readable labels and its existing subject as title. Existing messages are untouched. Removing the configuration restores the ordinary read-only form; no stored message conversion is involved. Migration 0013 follows the published migration inventory without importing other workers' unmerged migrations: the runner sorts filenames and permits gaps; fresh migration tests boot this branch independently.

## Open Questions

None. Independent UI verification passed. Manager reported the ordinary review findings and cleared the model-provenance hold; provenance remains unverified, without an extra review solely for identity. The migration collision is resolved by reserving 0013 against the published inventory. Owner defaults authorize sync/archive without a routine video-review pause; screenshots and clips were captured and inspected by agents, not claimed watched by Siraj. Merge and deployment remain owner-authorized actions.
