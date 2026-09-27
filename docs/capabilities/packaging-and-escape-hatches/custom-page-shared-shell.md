---
id: custom-page-shared-shell
kind: capability
title: Custom page in the shared shell
status: planned
order: 63
parent: packaging-escape-hatches
summary: A package-owned React page retaining Featherbase navigation, identity and runtime services.
issues:
  - 277
related:
  - custom-page
  - custom-block
  - whole-custom-client
---

# Custom page in the shared shell

## Purpose

This extension point lets an application keep Featherbase's shell and shared
services while replacing one page with domain-specific React.

## Current scope

The tracked work covers registered pages, navigation, landing rules and browser
security policy. Arbitrary replacement of core screens is not part of the
compatibility promise.

<!-- capability-catalog:start -->

## Sub-capabilities

No reusable sub-capabilities have been separated yet.

## Connections

**Parent:** [Packaging and escape hatches](./README.md)

**Related capabilities:** [Custom](../page-intents/custom.md), [Custom block](../core-blocks/custom.md), [Whole custom client](./whole-custom-client.md)

**Specifications:** Not yet written

**Tickets:** [#277](https://github.com/siraj-samsudeen/featherbase/issues/277)

**Proving applications:** None recorded.

<!-- capability-catalog:end -->
