---
id: tasker
kind: proving-application
title: Tasker
stage: proven
order: 101
summary: The existing runtime application proving package ownership, governed records, actions and a whole custom React client.
capabilities:
  - collection-page
  - record-page
  - custom-page
  - metadata-records
  - authentication-permissions
  - transactional-actions
  - runtime-application-package
  - whole-custom-client
---

# Tasker

## Purpose

Tasker is the existing reference runtime application. It proves that a trusted
package can own metadata-defined records, roles, transactional actions and an
ordinary React client while installing and upgrading through Featherbase.

## What it proves

- A package can own tables and records without editing the generic platform.
- Application roles and permissions use the shared identity model.
- Domain operations execute through governed transactional actions.
- A package can ship and host a complete custom React client.

## Boundary of the evidence

Tasker owns its whole client, so it does not prove the new declarative page and
block contracts. Training is the intended proving application for those
contracts. This distinction prevents an existing custom client from making a
portable UI capability appear Available before applications can actually
declare it.

<!-- capability-catalog:start -->

## Capabilities proved

| Capability | Status | Description | Specifications | Tickets |
| --- | --- | --- | --- | --- |
| [Collection](../page-intents/collection.md) | ◐ Partial | A searchable, filterable, sortable and pageable set of records with saved views and actions. | [list-view](../../../openspec/specs/list-view/spec.md), [saved-views](../../../openspec/specs/saved-views/spec.md) | — |
| [Record](../page-intents/record.md) | ◐ Partial | One record viewed, created or edited with fields, relations, actions, history and attachments. | [core-forms](../../../openspec/specs/core-forms/spec.md), [tables-and-fields](../../../openspec/specs/tables-and-fields/spec.md) | — |
| [Custom](../page-intents/custom.md) | ◐ Partial | A full React page for an exceptional domain workbench that does not fit the standard intents. | [trusted-runtime-packages](../../../openspec/specs/trusted-runtime-packages/spec.md) | [#277](https://github.com/siraj-samsudeen/featherbase/issues/277) |
| [Metadata and records](../runtime-services/metadata-records.md) | ✓ Available | Schemas, validation, relations, child records and the governed record lifecycle. | [tables-and-fields](../../../openspec/specs/tables-and-fields/spec.md) | — |
| [Authentication and permissions](../runtime-services/authentication-permissions.md) | ✓ Available | Accounts, sessions, roles and table-, row- and field-level authorization. | [sign-in-and-accounts](../../../openspec/specs/sign-in-and-accounts/spec.md), [permissions-and-roles](../../../openspec/specs/permissions-and-roles/spec.md) | — |
| [Transactional actions](../runtime-services/transactional-actions.md) | ✓ Available | Permission-checked, transactional and idempotent custom server operations. | [transactional-runtime-actions](../../../openspec/specs/transactional-runtime-actions/spec.md) | — |
| [Runtime application package](../packaging-and-escape-hatches/runtime-application-package.md) | ✓ Available | An additively upgradeable unit owning tables, migrations, actions, roles and an optional custom client. | [trusted-runtime-packages](../../../openspec/specs/trusted-runtime-packages/spec.md) | — |
| [Whole custom client](../packaging-and-escape-hatches/whole-custom-client.md) | ✓ Available | An ordinary React client shipped by a trusted package for behavior outside the standard page model. | [trusted-runtime-packages](../../../openspec/specs/trusted-runtime-packages/spec.md) | — |

## Connections

**Related capabilities:** None recorded.

**Specifications:** Not yet written

**Tickets:** —

<!-- capability-catalog:end -->
