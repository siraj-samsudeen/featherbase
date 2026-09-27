---
id: drag-and-drop-page-builder
kind: design-option
title: Drag-and-drop page builder
disposition: deferred
order: 81
parent: page-intents
summary: Add a human visual editor for assembling application pages and blocks.
related:
  - core-blocks
  - workspace-page
---

# Drag-and-drop page builder

## Question considered

Should Featherbase optimize first for humans visually arranging pages, as
traditional low-code products do?

## Advantages

- Non-programmers can discover and arrange supported components directly.
- Immediate visual feedback can help with presentation-heavy pages.

## Costs

- It creates editor state, interaction design, versioning and migration work
  before the underlying application grammar is proven.
- Visual builders tend to optimize for human clicking rather than durable,
  reviewable declarations that agents can author and change reliably.
- Complex behavior still requires code and a way to reconcile visual and code
  edits.

## Decision and revisit condition

Deferred. Featherbase is agent-first, not a human no-code builder. Revisit after
the declaration format is stable and real consumers need human visual editing;
the builder must edit the same durable declarations rather than create a second
source of truth.

<!-- capability-catalog:start -->

## Connections

**Parent:** [Page intents](../page-intents/README.md)

**Related capabilities:** [Core blocks](../core-blocks/README.md), [Workspace](../page-intents/workspace.md)

**Specifications:** Not yet written

**Tickets:** —

**Proving applications:** None recorded.

<!-- capability-catalog:end -->
