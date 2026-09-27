---
id: runtime-services
kind: capability-group
title: Runtime services
status: partial
order: 40
summary: Shared security, data, workflow, files and operational behavior supplied to every application.
related:
  - page-intents
  - core-blocks
  - packaging-escape-hatches
---

# Runtime services

## Purpose

Runtime services keep page declarations and custom code small. Applications
reuse Featherbase's authorization, transactions, audit and operational behavior
instead of independently rebuilding it.

## Declaration and code boundary

Durable definitions remain the source of truth for recurring behavior. The
existing workflow engine, permissions and other runtime services are configured
declaratively. TypeScript is used at named extension points to compute facts or
perform domain behavior the generic service cannot know—for example whether a
Training answer is correct—not to replace the workflow engine itself.

This boundary follows the platform's broader
[agent-first development](../../../README.md#agent-first-development) rule:
declarations own recurring behavior, while ordinary code owns domain-specific
facts and integrations.

<!-- capability-catalog:start -->

## Sub-capabilities

| Capability | Status | Description | Specifications | Tickets |
| --- | --- | --- | --- | --- |
| [Metadata and records](./metadata-records.md) | ✓ Available | Schemas, validation, relations, child records and the governed record lifecycle. | [tables-and-fields](../../../openspec/specs/tables-and-fields/spec.md) | — |
| [Authentication and permissions](./authentication-permissions.md) | ✓ Available | Accounts, sessions, roles and table-, row- and field-level authorization. | [sign-in-and-accounts](../../../openspec/specs/sign-in-and-accounts/spec.md), [permissions-and-roles](../../../openspec/specs/permissions-and-roles/spec.md) | — |
| [Queries and saved views](./queries-saved-views.md) | ✓ Available | Filtering, sorting, pagination, reusable views and relationship exploration. | [list-view](../../../openspec/specs/list-view/spec.md), [saved-views](../../../openspec/specs/saved-views/spec.md), [search-and-explore](../../../openspec/specs/search-and-explore/spec.md) | — |
| [Transactional actions](./transactional-actions.md) | ✓ Available | Permission-checked, transactional and idempotent custom server operations. | [transactional-runtime-actions](../../../openspec/specs/transactional-runtime-actions/spec.md) | — |
| [Workflow](./workflow.md) | ◐ Partial | States, transitions, approvals and assignment through Featherbase's existing workflow engine. | [workflow-and-approvals](../../../openspec/specs/workflow-and-approvals/spec.md) | — |
| [Files](./files.md) | ◐ Partial | Authorized upload, download and attachment behavior with pluggable durable storage. | [files-and-sharing](../../../openspec/specs/files-and-sharing/spec.md) | [#165](https://github.com/siraj-samsudeen/featherbase/issues/165) |
| [Audit, comments and engagement](./audit-comments-engagement.md) | ◐ Partial | Security history, collaboration events and opt-in measurement of active application use. | [comments-and-history](../../../openspec/specs/comments-and-history/spec.md) | — |
| [Notifications and jobs](./notifications-jobs.md) | ◐ Partial | Email, webhooks, queued work, schedules, retries and application health. | [notifications-email-and-webhooks](../../../openspec/specs/notifications-email-and-webhooks/spec.md), [background-and-scheduled-jobs](../../../openspec/specs/background-and-scheduled-jobs/spec.md) | [#284](https://github.com/siraj-samsudeen/featherbase/issues/284) |
| [Import, export and print](./import-export-print.md) | ◐ Partial | Spreadsheet ingestion, tabular export and printable record or report views. | [spreadsheet-import](../../../openspec/specs/spreadsheet-import/spec.md), [reports-and-charts](../../../openspec/specs/reports-and-charts/spec.md), [printing](../../../openspec/specs/printing/spec.md) | — |

## Connections

**Related capabilities:** [Page intents](../page-intents/README.md), [Core blocks](../core-blocks/README.md), [Packaging and escape hatches](../packaging-and-escape-hatches/README.md)

**Specifications:** Not yet written

**Tickets:** —

**Proving applications:** None recorded.

<!-- capability-catalog:end -->
