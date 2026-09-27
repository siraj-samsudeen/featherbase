---
id: custom-block
kind: capability
title: Custom block
status: not-started
order: 30
parent: core-blocks
summary: A named React component with validated inputs and the same runtime services as standard blocks.
related:
  - custom-page
  - custom-page-shared-shell
---

# Custom block

## Purpose

A Custom block is the local escape hatch when most of a page fits the standard
model but one section needs domain-specific React.

## Current scope

Trusted packages can own a complete client. No component-registration,
validated-input or shared-runtime contract for an embedded custom block has
been specified.

<!-- capability-catalog:start -->

## Sub-capabilities

No reusable sub-capabilities have been separated yet.

## Connections

**Parent:** [Core blocks](./README.md)

**Related capabilities:** [Custom](../page-intents/custom.md), [Custom page in the shared shell](../packaging-and-escape-hatches/custom-page-shared-shell.md)

**Specifications:** Not yet written

**Tickets:** —

**Proving applications:** None recorded.

<!-- capability-catalog:end -->
