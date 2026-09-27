---
id: arbitrary-component-tree-json
kind: design-option
title: Arbitrary component-tree JSON
disposition: deferred
order: 80
parent: page-intents
summary: Let declarations describe any nested user-interface component tree rather than a small page-and-block grammar.
related:
  - core-blocks
  - custom-block
---

# Arbitrary component-tree JSON

## Question considered

Should Featherbase let an agent describe any possible React layout and component
tree in JSON?

## Advantages

- More layouts could be represented without a custom page.
- A sufficiently complete renderer could make declarations highly expressive.

## Costs

- The declaration becomes a second programming language for React.
- Agents must learn a large component schema and still escape to code for
  behavior the schema did not anticipate.
- Renderer evolution creates a broad compatibility surface.
- Visual flexibility can obscure the recurring application behavior the
  framework is meant to standardize.

## Decision and revisit condition

Deferred in favor of five page intents, ten behavior-rich blocks and explicit
Custom page/block escape hatches. Revisit only when at least two real
applications repeatedly require the same composition that cannot be expressed
by extending a block or using a custom component.

<!-- capability-catalog:start -->

## Connections

**Parent:** [Page intents](../page-intents/README.md)

**Related capabilities:** [Core blocks](../core-blocks/README.md), [Custom block](../core-blocks/custom.md)

**Specifications:** Not yet written

**Tickets:** —

**Proving applications:** None recorded.

<!-- capability-catalog:end -->
