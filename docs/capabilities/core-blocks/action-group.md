---
id: action-group-block
kind: capability
title: Action group
status: partial
order: 25
parent: core-blocks
summary: Record, selection, collection, navigation and workflow actions with parameters and confirmation.
specifications:
  - workflow-and-approvals
  - transactional-runtime-actions
related:
  - transactional-actions
  - workflow
  - collection-block
alternatives:
  - visual-workflow-designer
proving_applications:
  - training
---

# Action group

## Purpose

An Action group presents permitted operations consistently and collects any
parameters or confirmation before invoking framework or application behavior.

## Current scope

Server actions and workflow transitions exist. Applications still hand-build
the controls that present them, so the portable presentation contract is
incomplete.

<!-- capability-catalog:start -->

## Sub-capabilities

No reusable sub-capabilities have been separated yet.

## Connections

**Parent:** [Core blocks](./README.md)

**Related capabilities:** [Transactional actions](../runtime-services/transactional-actions.md), [Workflow](../runtime-services/workflow.md), [Collection block](./collection.md)

**Specifications:** [workflow-and-approvals](../../../openspec/specs/workflow-and-approvals/spec.md), [transactional-runtime-actions](../../../openspec/specs/transactional-runtime-actions/spec.md)

**Tickets:** —

**Proving applications:** [Training](../proving-applications/training.md)

## Design options

- [Visual workflow designer](../design-options/visual-workflow-designer.md) — **Deferred.** Add a graphical editor for states, transitions, conditions and approvals.

<!-- capability-catalog:end -->
