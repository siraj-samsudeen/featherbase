---
id: visual-workflow-designer
kind: design-option
title: Visual workflow designer
disposition: deferred
order: 82
parent: workflow
summary: Add a graphical editor for states, transitions, conditions and approvals.
related:
  - action-group-block
---

# Visual workflow designer

## Question considered

Does the reusable workflow engine also need a graphical authoring surface in
the initial agent-first product?

## Advantages

- A graph can make branching transitions and approval paths easier for people
  to inspect.
- Business users may eventually edit simple workflows without changing files.

## Costs

- The editor adds a second representation unless it is a faithful view of the
  same durable declarations.
- Graph editing, validation and merge behavior add substantial UI complexity.
- It does not help the first agents define workflows more reliably than a
  concise declarative contract.

## Decision and revisit condition

Deferred while Featherbase reuses its existing workflow engine and proves
package-owned workflow declarations through Training. Revisit when human
workflow ownership becomes a repeated requirement.

<!-- capability-catalog:start -->

## Connections

**Parent:** [Workflow](../runtime-services/workflow.md)

**Related capabilities:** [Action group](../core-blocks/action-group.md)

**Specifications:** Not yet written

**Tickets:** —

**Proving applications:** None recorded.

<!-- capability-catalog:end -->
