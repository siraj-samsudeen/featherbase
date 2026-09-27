---
id: workflow
kind: capability
title: Workflow
status: partial
order: 45
parent: runtime-services
summary: States, transitions, approvals and assignment through Featherbase's existing workflow engine.
specifications:
  - workflow-and-approvals
related:
  - action-group-block
  - transactional-actions
proving_applications:
  - Training
alternatives:
  - visual-workflow-designer
---

# Workflow

## Purpose

Workflow governs state and permitted transitions. Applications declare the
reusable state machine and call custom code only for facts the engine cannot
derive generically.

## Current scope

The workflow engine is available. Runtime packages cannot yet install and own
all workflow definitions as managed package content, and declarative pages do
not yet render workflow actions automatically.

For Training, submission, grading result and pass state belong to workflow;
calculating whether a particular answer is correct belongs to application code.

<!-- capability-catalog:start -->

## Sub-capabilities

No reusable sub-capabilities have been separated yet.

## Connections

**Parent:** [Runtime services](./README.md)

**Related capabilities:** [Action group](../core-blocks/action-group.md), [Transactional actions](./transactional-actions.md)

**Specifications:** [workflow-and-approvals](../../../openspec/specs/workflow-and-approvals/spec.md)

**Tickets:** —

**Proving applications:** Training

## Design options

- [Visual workflow designer](../design-options/visual-workflow-designer.md) — **Deferred.** Add a graphical editor for states, transitions, conditions and approvals.

<!-- capability-catalog:end -->
