---
id: custom-page
kind: capability
title: Custom
status: partial
order: 15
parent: page-intents
summary: A full React page for an exceptional domain workbench that does not fit the standard intents.
specifications:
  - trusted-runtime-packages
issues:
  - 277
related:
  - custom-page-shared-shell
  - whole-custom-client
  - custom-block
proving_applications:
  - tasker
---

# Custom

## Purpose

A Custom page preserves normal React as the escape hatch for point of sale,
reconciliation, domain visualization or another interaction that standard pages
cannot express cleanly.

## Current scope

A trusted package can ship a whole client today. A package-owned page mounted
inside Featherbase's shared shell—with identity, navigation and runtime
services—is planned but not yet specified.

The compatibility promise applies at documented extension points; it does not
promise that an application can replace arbitrary framework internals.

<!-- capability-catalog:start -->

## Sub-capabilities

No reusable sub-capabilities have been separated yet.

## Connections

**Parent:** [Page intents](./README.md)

**Related capabilities:** [Custom page in the shared shell](../packaging-and-escape-hatches/custom-page-shared-shell.md), [Whole custom client](../packaging-and-escape-hatches/whole-custom-client.md), [Custom block](../core-blocks/custom.md)

**Specifications:** [trusted-runtime-packages](../../../openspec/specs/trusted-runtime-packages/spec.md)

**Tickets:** [#277](https://github.com/siraj-samsudeen/featherbase/issues/277)

**Proving applications:** [Tasker](../proving-applications/tasker.md)

<!-- capability-catalog:end -->
