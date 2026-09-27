---
id: whole-custom-client
kind: capability
title: Whole custom client
status: available
order: 62
parent: packaging-escape-hatches
summary: An ordinary React client shipped by a trusted package for behavior outside the standard page model.
specifications:
  - trusted-runtime-packages
related:
  - custom-page
  - custom-page-shared-shell
  - runtime-application-package
proving_applications:
  - Tasker
---

# Whole custom client

## Purpose

A package can ship an ordinary React application when the framework's standard
pages and blocks would constrain the domain rather than simplify it.

## Current scope

This is available and proves that declarations are a default rather than a
limit. The cost is that the package owns more navigation and page wiring than a
client assembled inside the shared shell.

<!-- capability-catalog:start -->

## Sub-capabilities

No reusable sub-capabilities have been separated yet.

## Connections

**Parent:** [Packaging and escape hatches](./README.md)

**Related capabilities:** [Custom](../page-intents/custom.md), [Custom page in the shared shell](./custom-page-shared-shell.md), [Runtime application package](./runtime-application-package.md)

**Specifications:** [trusted-runtime-packages](../../../openspec/specs/trusted-runtime-packages/spec.md)

**Tickets:** —

**Proving applications:** Tasker

<!-- capability-catalog:end -->
