---
id: collection-block
kind: capability
title: Collection block
status: partial
order: 22
parent: core-blocks
summary: Records rendered as a table, compact list, cards, board, calendar or timeline with shared query behavior.
specifications:
  - list-view
  - board-calendar-and-timeline-views
related:
  - collection-page
  - queries-saved-views
  - action-group-block
---

# Collection block

## Purpose

The Collection block embeds a set of records inside another page while keeping
filtering, sorting, pagination, saved views, selection and actions consistent.

## Current scope

The generic Admin provides several projections. Their common portable block
contract and renderer selection are not yet specified.

<!-- capability-catalog:start -->

## Sub-capabilities

No reusable sub-capabilities have been separated yet.

## Connections

**Parent:** [Core blocks](./README.md)

**Related capabilities:** [Collection](../page-intents/collection.md), [Queries and saved views](../runtime-services/queries-saved-views.md), [Action group](./action-group.md)

**Specifications:** [list-view](../../../openspec/specs/list-view/spec.md), [board-calendar-and-timeline-views](../../../openspec/specs/board-calendar-and-timeline-views/spec.md)

**Tickets:** —

**Proving applications:** None recorded.

<!-- capability-catalog:end -->
