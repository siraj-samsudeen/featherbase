---
id: page-intents
kind: capability-group
title: Page intents
status: partial
order: 10
summary: Five reasons an application page exists, independent of its visual arrangement.
related:
  - core-blocks
  - runtime-services
alternatives:
  - arbitrary-component-tree-json
  - drag-and-drop-page-builder
---

# Page intents

## Purpose

Page intents give agents a small, stable vocabulary for choosing a standard
application surface before writing custom React. They describe why a page
exists; blocks describe what appears inside it.

## Current direction

Featherbase starts with Workspace, Collection, Record, Report and Custom. The
first four reuse framework behavior. Custom is the explicit escape hatch when a
domain workbench does not fit them.

The goal is not to encode arbitrary React trees in JSON. An agent should be able
to declare ordinary application pages concisely and move to normal code when
the page is exceptional.

## Influences and boundaries

Frappe and ERPNext demonstrate the value of metadata-driven records, generic
administration and installable applications. React-admin and Refine demonstrate
resource-centered list, show, create and edit surfaces. JSON Forms demonstrates
schema-driven field rendering. Rails, ActiveAdmin, Administrate and Avo
demonstrate how strong conventions remove repetitive application wiring.

Featherbase takes the recurring application behavior from those approaches,
but changes the primary author from a human framework user to a coding agent.
The result is a small page-and-block grammar with normal React escape hatches,
not a visual builder or a JSON encoding of every possible component.

The broader trade-off is documented in
[Human visual building or agent-authored declarations](../../../README.md#human-visual-building-or-agent-authored-declarations).

<!-- capability-catalog:start -->

## Sub-capabilities

| Capability | Status | Description | Specifications | Tickets |
| --- | --- | --- | --- | --- |
| [Workspace](./workspace.md) | ◐ Partial | A role-aware landing page of navigation, shortcuts, metrics, charts and important collections. | [dashboards-and-home-pages](../../../openspec/specs/dashboards-and-home-pages/spec.md) | [#277](https://github.com/siraj-samsudeen/featherbase/issues/277) |
| [Collection](./collection.md) | ◐ Partial | A searchable, filterable, sortable and pageable set of records with saved views and actions. | [list-view](../../../openspec/specs/list-view/spec.md), [saved-views](../../../openspec/specs/saved-views/spec.md) | — |
| [Record](./record.md) | ◐ Partial | One record viewed, created or edited with fields, relations, actions, history and attachments. | [core-forms](../../../openspec/specs/core-forms/spec.md), [tables-and-fields](../../../openspec/specs/tables-and-fields/spec.md) | — |
| [Report](./report.md) | ◐ Partial | A parameterized query with typed results, totals, charts, saved variants, export and drill-through. | [reports-and-charts](../../../openspec/specs/reports-and-charts/spec.md) | — |
| [Custom](./custom.md) | ◐ Partial | A full React page for an exceptional domain workbench that does not fit the standard intents. | [trusted-runtime-packages](../../../openspec/specs/trusted-runtime-packages/spec.md) | [#277](https://github.com/siraj-samsudeen/featherbase/issues/277) |

## Connections

**Related capabilities:** [Core blocks](../core-blocks/README.md), [Runtime services](../runtime-services/README.md)

**Specifications:** Not yet written

**Tickets:** —

**Proving applications:** None recorded.

## Design options

- [Arbitrary component-tree JSON](../design-options/arbitrary-component-tree-json.md) — **Deferred.** Let declarations describe any nested user-interface component tree rather than a small page-and-block grammar.
- [Drag-and-drop page builder](../design-options/drag-and-drop-page-builder.md) — **Deferred.** Add a human visual editor for assembling application pages and blocks.

<!-- capability-catalog:end -->
