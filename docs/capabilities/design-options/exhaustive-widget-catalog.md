---
id: exhaustive-widget-catalog
kind: design-option
title: Exhaustive widget catalog
disposition: deferred
order: 83
parent: core-blocks
summary: Predefine a large catalog of specialized visual widgets before applications prove their repeated behavior.
related:
  - custom-block
  - chart-block
---

# Exhaustive widget catalog

## Question considered

Should Featherbase ship every plausible table, chart, calendar, layout and
input variation as a named framework block?

## Advantages

- More screens appear buildable without custom code on day one.
- A large menu can help users discover presentation options.

## Costs

- Similar-looking widgets often hide different behavior and create overlapping
  concepts.
- Every public widget becomes an implementation, documentation and upgrade
  obligation.
- Speculative widgets distract from the small set of recurring application
  tasks agents actually need.

## Decision and revisit condition

Deferred. New projections, field renderers and blocks enter the framework only
after real applications prove that agents repeatedly rebuild the same behavior.

<!-- capability-catalog:start -->

## Connections

**Parent:** [Core blocks](../core-blocks/README.md)

**Related capabilities:** [Custom block](../core-blocks/custom.md), [Chart](../core-blocks/chart.md)

**Specifications:** Not yet written

**Tickets:** —

**Proving applications:** None recorded.

<!-- capability-catalog:end -->
