---
id: runtime-application-package
kind: capability
title: Runtime application package
status: available
order: 61
parent: packaging-escape-hatches
summary: An additively upgradeable unit owning tables, migrations, actions, roles and an optional custom client.
specifications:
  - trusted-runtime-packages
related:
  - metadata-records
  - transactional-actions
  - whole-custom-client
  - application-extraction-import
proving_applications:
  - tasker
  - training
alternatives:
  - one-time-generated-application
  - declarative-only-migrations
---

# Runtime application package

## Purpose

The package is the unit an agent develops, installs, upgrades, extracts and
moves. It owns every artifact required for application portability.

## Current scope

Trusted packages can own tables, additive migrations, actions, roles and a
client. Static package JSON remains the canonical declaration initially.
Durable declarations are not generated editable code; custom TypeScript plugs
into named extension points.

The intended migration model is hybrid: common changes are declarative, while
trusted SQL or TypeScript handles exceptional transformations. Featherbase owns
ordering, preview, the applied-migration ledger, transaction boundaries and
failure reporting.

Package content will distinguish managed definitions, customer-editable starter
content and optional demonstration content. That content contract is not yet
complete.

<!-- capability-catalog:start -->

## Sub-capabilities

No reusable sub-capabilities have been separated yet.

## Connections

**Parent:** [Packaging and escape hatches](./README.md)

**Related capabilities:** [Metadata and records](../runtime-services/metadata-records.md), [Transactional actions](../runtime-services/transactional-actions.md), [Whole custom client](./whole-custom-client.md), [Application extraction and import](./application-extraction-import.md)

**Specifications:** [trusted-runtime-packages](../../../openspec/specs/trusted-runtime-packages/spec.md)

**Tickets:** —

**Proving applications:** [Tasker](../proving-applications/tasker.md), [Training](../proving-applications/training.md)

## Design options

- [One-time generated application](../design-options/one-time-generated-application.md) — **Rejected.** Generate a standalone editable codebase from declarations and remove the Featherbase runtime dependency.
- [Declarative-only migrations](../design-options/declarative-only-migrations.md) — **Rejected.** Permit package upgrades to express every schema and data transformation only through framework declarations.

<!-- capability-catalog:end -->
