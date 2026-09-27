---
id: training
kind: proving-application
title: Training
stage: planned
order: 100
summary: Rebuild the existing daily-exercise course as a portable Featherbase application and use it to prove the missing generic contracts.
capabilities:
  - workspace-page
  - record-page
  - content-block
  - field-group-block
  - action-group-block
  - activity-timeline-block
  - attachments-block
  - metadata-records
  - authentication-permissions
  - transactional-actions
  - workflow
  - files
  - audit-comments-engagement
  - runtime-application-package
---

# Training

## Purpose

Training is the first vertical-slice proving application for the agent-authored
page-and-block model. Every missing behavior should become a generic Featherbase
contract and be used immediately by Training; application-specific grading
logic remains ordinary code.

The starting reference is
[JeyaramaGroup/data-warehouse PR #3567](https://github.com/JeyaramaGroup/data-warehouse/pull/3567).
That Hono, TypeScript and Postgres application is similar to Advent of Code: a
learner opens daily exercises, works them and submits answers for grading.

## Existing reference behavior

- Teacher, teaching-assistant and learner roles.
- Two currently served lessons, despite a longer curriculum.
- Learn → Practice → Test within each lesson.
- Two answer attempts and scalar grading.
- Workbook upload and download, questions, resources, lesson editing and
  history, and staff activity views.
- A small synchronous Python bridge that reads a CSV, calculates expected
  answers and returns JSON.

These describe the source application, not a requirement to reproduce every
feature in the first Featherbase slice.

## First proving slice

The first user-facing release must let a learner:

1. sign in through Featherbase;
2. see and open Lessons 1 and 2;
3. accumulate visible-tab active time through heartbeat events;
4. submit an answer and receive a simple synchronous result; and
5. complete the submission → result → pass lifecycle while staff can inspect
   the audit trail.

The slice must not wait for a generalized grading subsystem, all 28 curriculum
days, every workbook workflow or every teacher-authoring feature. A minimal
app-specific grader is sufficient to prove the lifecycle.

## Framework boundary

- Featherbase declarations own tables, roles, page composition, workflow,
  files, audit and installation.
- The existing workflow engine owns submission, result and pass states.
- TypeScript computes the domain fact “is this answer correct?” through a
  transactional action; it does not replace the workflow engine.
- Package assets are read-only. Learner workbooks and other customer uploads
  use the Featherbase file service.
- Active time counts only while the lesson tab is visible and heartbeats are
  arriving; it is engagement evidence, not the security audit log.

## Proof method

Build one thin end-to-end path at a time. When Training needs repeated wiring,
add the smallest generic extension point and immediately consume it in the same
slice. Do not build a speculative application framework ahead of the proving
application.

<!-- capability-catalog:start -->

## Capabilities proved

| Capability | Status | Description | Specifications | Tickets |
| --- | --- | --- | --- | --- |
| [Workspace](../page-intents/workspace.md) | ◐ Partial | A role-aware landing page of navigation, shortcuts, metrics, charts and important collections. | [dashboards-and-home-pages](../../../openspec/specs/dashboards-and-home-pages/spec.md) | [#277](https://github.com/siraj-samsudeen/featherbase/issues/277) |
| [Record](../page-intents/record.md) | ◐ Partial | One record viewed, created or edited with fields, relations, actions, history and attachments. | [core-forms](../../../openspec/specs/core-forms/spec.md), [tables-and-fields](../../../openspec/specs/tables-and-fields/spec.md) | — |
| [Content block](../core-blocks/content.md) | ◐ Partial | Markdown or safe rich content for lessons, instructions and static sections. | [web-forms-and-portal](../../../openspec/specs/web-forms-and-portal/spec.md) | — |
| [Field group](../core-blocks/field-group.md) | ◐ Partial | Metadata-defined fields with responsive layout, validation, dirty state and conflict handling. | [core-forms](../../../openspec/specs/core-forms/spec.md) | — |
| [Action group](../core-blocks/action-group.md) | ◐ Partial | Record, selection, collection, navigation and workflow actions with parameters and confirmation. | [workflow-and-approvals](../../../openspec/specs/workflow-and-approvals/spec.md), [transactional-runtime-actions](../../../openspec/specs/transactional-runtime-actions/spec.md) | — |
| [Activity timeline](../core-blocks/activity-timeline.md) | ◐ Partial | Comments, field changes, workflow transitions and command history in one attributable sequence. | [comments-and-history](../../../openspec/specs/comments-and-history/spec.md) | — |
| [Attachments](../core-blocks/attachments.md) | ◐ Partial | Authorized upload, listing, preview, download and removal of files attached to a record. | [files-and-sharing](../../../openspec/specs/files-and-sharing/spec.md) | [#165](https://github.com/siraj-samsudeen/featherbase/issues/165) |
| [Metadata and records](../runtime-services/metadata-records.md) | ✓ Available | Schemas, validation, relations, child records and the governed record lifecycle. | [tables-and-fields](../../../openspec/specs/tables-and-fields/spec.md) | — |
| [Authentication and permissions](../runtime-services/authentication-permissions.md) | ✓ Available | Accounts, sessions, roles and table-, row- and field-level authorization. | [sign-in-and-accounts](../../../openspec/specs/sign-in-and-accounts/spec.md), [permissions-and-roles](../../../openspec/specs/permissions-and-roles/spec.md) | — |
| [Transactional actions](../runtime-services/transactional-actions.md) | ✓ Available | Permission-checked, transactional and idempotent custom server operations. | [transactional-runtime-actions](../../../openspec/specs/transactional-runtime-actions/spec.md) | — |
| [Workflow](../runtime-services/workflow.md) | ◐ Partial | States, transitions, approvals and assignment through Featherbase's existing workflow engine. | [workflow-and-approvals](../../../openspec/specs/workflow-and-approvals/spec.md) | — |
| [Files](../runtime-services/files.md) | ◐ Partial | Authorized upload, download and attachment behavior with pluggable durable storage. | [files-and-sharing](../../../openspec/specs/files-and-sharing/spec.md) | [#165](https://github.com/siraj-samsudeen/featherbase/issues/165) |
| [Audit, comments and engagement](../runtime-services/audit-comments-engagement.md) | ◐ Partial | Security history, collaboration events and opt-in measurement of active application use. | [comments-and-history](../../../openspec/specs/comments-and-history/spec.md) | — |
| [Runtime application package](../packaging-and-escape-hatches/runtime-application-package.md) | ✓ Available | An additively upgradeable unit owning tables, migrations, actions, roles and an optional custom client. | [trusted-runtime-packages](../../../openspec/specs/trusted-runtime-packages/spec.md) | — |

## Connections

**Related capabilities:** None recorded.

**Specifications:** Not yet written

**Tickets:** —

<!-- capability-catalog:end -->
