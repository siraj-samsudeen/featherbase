---
id: transactional-actions
kind: capability
title: Transactional actions
status: available
order: 44
parent: runtime-services
summary: Permission-checked, transactional and idempotent custom server operations.
specifications:
  - transactional-runtime-actions
related:
  - action-group-block
  - workflow
  - namespaced-server-route
proving_applications:
  - tasker
  - training
---

# Transactional actions

## Purpose

Transactional actions are the normal code escape hatch for domain operations
that must run with Featherbase authorization and transaction guarantees.

## Current scope

Trusted packages can declare and execute actions today. Training's answer check
should use an action to calculate the app-specific correctness fact while the
workflow engine owns the resulting state transition.

<!-- capability-catalog:start -->

## Sub-capabilities

No reusable sub-capabilities have been separated yet.

## Connections

**Parent:** [Runtime services](./README.md)

**Related capabilities:** [Action group](../core-blocks/action-group.md), [Workflow](./workflow.md), [Namespaced server route](../packaging-and-escape-hatches/namespaced-server-route.md)

**Specifications:** [transactional-runtime-actions](../../../openspec/specs/transactional-runtime-actions/spec.md)

**Tickets:** —

**Proving applications:** [Tasker](../proving-applications/tasker.md), [Training](../proving-applications/training.md)

<!-- capability-catalog:end -->
