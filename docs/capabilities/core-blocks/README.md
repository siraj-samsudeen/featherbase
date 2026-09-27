---
id: core-blocks
kind: capability-group
title: Core blocks
status: partial
order: 20
summary: Reusable page sections that carry common application behavior without describing arbitrary React trees.
related:
  - page-intents
  - runtime-services
alternatives:
  - exhaustive-widget-catalog
  - arbitrary-component-tree-json
---

# Core blocks

## Purpose

Blocks compose standard pages from a small set of behavior-rich sections.
Input controls, table styles and other visual variants remain renderer choices
inside blocks rather than becoming new top-level concepts.

## Current direction

The initial set is Content, Collection, Field group, Relation and child grid,
Action group, Activity timeline, Attachments, Metric, Chart and Custom block.
Agents should reuse these for recurring behavior and register custom code only
when a real application proves the standard set insufficient.

<!-- capability-catalog:start -->

## Sub-capabilities

| Capability | Status | Description | Specifications | Tickets |
| --- | --- | --- | --- | --- |
| [Content block](./content.md) | ◐ Partial | Markdown or safe rich content for lessons, instructions and static sections. | [web-forms-and-portal](../../../openspec/specs/web-forms-and-portal/spec.md) | — |
| [Collection block](./collection.md) | ◐ Partial | Records rendered as a table, compact list, cards, board, calendar or timeline with shared query behavior. | [list-view](../../../openspec/specs/list-view/spec.md), [board-calendar-and-timeline-views](../../../openspec/specs/board-calendar-and-timeline-views/spec.md) | — |
| [Field group](./field-group.md) | ◐ Partial | Metadata-defined fields with responsive layout, validation, dirty state and conflict handling. | [core-forms](../../../openspec/specs/core-forms/spec.md) | — |
| [Relation and child grid](./relation-child-grid.md) | ◐ Partial | Lookups, related collections and editable parent-child transaction rows. | [tables-and-fields](../../../openspec/specs/tables-and-fields/spec.md) | — |
| [Action group](./action-group.md) | ◐ Partial | Record, selection, collection, navigation and workflow actions with parameters and confirmation. | [workflow-and-approvals](../../../openspec/specs/workflow-and-approvals/spec.md), [transactional-runtime-actions](../../../openspec/specs/transactional-runtime-actions/spec.md) | — |
| [Activity timeline](./activity-timeline.md) | ◐ Partial | Comments, field changes, workflow transitions and command history in one attributable sequence. | [comments-and-history](../../../openspec/specs/comments-and-history/spec.md) | — |
| [Attachments](./attachments.md) | ◐ Partial | Authorized upload, listing, preview, download and removal of files attached to a record. | [files-and-sharing](../../../openspec/specs/files-and-sharing/spec.md) | [#165](https://github.com/siraj-samsudeen/featherbase/issues/165) |
| [Metric](./metric.md) | ◐ Partial | A scalar result with an optional comparison, business status or trend. | [dashboards-and-home-pages](../../../openspec/specs/dashboards-and-home-pages/spec.md) | — |
| [Chart](./chart.md) | ◐ Partial | Query or report results projected through a small supported set of chart encodings. | [reports-and-charts](../../../openspec/specs/reports-and-charts/spec.md) | — |
| [Custom block](./custom.md) | ○ Not started | A named React component with validated inputs and the same runtime services as standard blocks. | Not yet written | — |

## Connections

**Related capabilities:** [Page intents](../page-intents/README.md), [Runtime services](../runtime-services/README.md)

**Specifications:** Not yet written

**Tickets:** —

**Proving applications:** None recorded.

## Design options

- [Exhaustive widget catalog](../design-options/exhaustive-widget-catalog.md) — **Deferred.** Predefine a large catalog of specialized visual widgets before applications prove their repeated behavior.
- [Arbitrary component-tree JSON](../design-options/arbitrary-component-tree-json.md) — **Deferred.** Let declarations describe any nested user-interface component tree rather than a small page-and-block grammar.

<!-- capability-catalog:end -->
