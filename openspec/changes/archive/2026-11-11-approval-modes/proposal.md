## Why

Every change proposal waits for an approver before anything changes. Approvers get no email, so proposals sit unanswered, and the people who raise a Your sections change can't see the reports it would give them (#1191). The owner agreed on 11-Nov-2026 that each kind of approval gets its own setting.

## What Changes

- An app declares its approval types. One Approval Type row per type sets how it works: **Approve first** (the default, and today's behaviour) or **Apply now, review after**.
- Under Apply now, the change is made when it is asked for and waits as Not yet reviewed. A reviewer confirms it or undoes it with a reason; the maker may undo their own while it is not yet reviewed.
- Undo puts the rows back as they were: the row it ended runs on, and the row it added is ended before it started and retired. It refuses, changing nothing, when either row has changed since or a row in use still links to the added one. The full record stays.
- A type that grants a role or report access is Approve first, always, whatever an administrator sets.
- Dash declares three types (add, Not mine, job section); the client instance sets them to Apply now.

## Capabilities

### Modified Capabilities

- `workflow-and-approvals`: approval types and their modes; confirm and undo.
- `my-sections`: changes made at once, shown as not yet reviewed, with Undo; the reviewer's Confirm and Undo.

## Impact

- `apps/server/src/change-proposals.ts`, `controllers/approval-type.ts`, `instance-settings.ts`, `document.ts` (a trusted retire), `packages/shared/src/runtime-actions.ts`, migration 0160.
- `client-apps/jeyarama/dash`: `my-sections.ts`, `sections-page.tsx`, the manifest's `approvalTypes`; the instance settings file.
