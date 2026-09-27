---
id: namespaced-server-route
kind: capability
title: Namespaced server route
status: planned
order: 64
parent: packaging-escape-hatches
summary: An authenticated package-owned HTTP endpoint for behavior that does not fit a transactional action.
issues:
  - 274
related:
  - transactional-actions
  - runtime-application-package
---

# Namespaced server route

## Purpose

Trusted applications sometimes need protocol or streaming behavior that cannot
be represented as a transactional command. A namespaced route provides that
escape hatch without editing the core server router.

## Current scope

The capability is tracked but not yet specified or implemented. Transactional
actions remain the preferred extension point for ordinary domain operations.

<!-- capability-catalog:start -->

## Sub-capabilities

No reusable sub-capabilities have been separated yet.

## Connections

**Parent:** [Packaging and escape hatches](./README.md)

**Related capabilities:** [Transactional actions](../runtime-services/transactional-actions.md), [Runtime application package](./runtime-application-package.md)

**Specifications:** Not yet written

**Tickets:** [#274](https://github.com/siraj-samsudeen/featherbase/issues/274)

**Proving applications:** None recorded.

<!-- capability-catalog:end -->
