---
id: declarative-only-migrations
kind: design-option
title: Declarative-only migrations
disposition: rejected
order: 88
parent: runtime-application-package
summary: Permit package upgrades to express every schema and data transformation only through framework declarations.
related:
  - metadata-records
  - application-extraction-import
---

# Declarative-only migrations

## Question considered

Should the migration system prohibit SQL or TypeScript and support only a safe
catalog of declarative changes?

## Advantages

- Common changes are easier to validate, preview and apply consistently.
- The framework can understand the intent of each supported operation.

## Costs

- Real upgrades eventually need data transformations the catalog did not
  anticipate.
- Expanding the migration language to cover every transformation recreates a
  programming language less capable than SQL and TypeScript.
- Applications may resort to unsafe workarounds outside the migration ledger.

## Decision and revisit condition

Rejected in favor of a hybrid model: declarations cover common changes;
trusted SQL or TypeScript covers exceptional transformations; Featherbase owns
ordering, preview, the ledger, transaction boundaries and failure reporting.

<!-- capability-catalog:start -->

## Connections

**Parent:** [Runtime application package](../packaging-and-escape-hatches/runtime-application-package.md)

**Related capabilities:** [Metadata and records](../runtime-services/metadata-records.md), [Application extraction and import](../packaging-and-escape-hatches/application-extraction-import.md)

**Specifications:** Not yet written

**Tickets:** —

**Proving applications:** None recorded.

<!-- capability-catalog:end -->
