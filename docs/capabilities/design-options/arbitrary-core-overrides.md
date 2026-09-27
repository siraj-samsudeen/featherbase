---
id: arbitrary-core-overrides
kind: design-option
title: Arbitrary core overrides
disposition: rejected
order: 89
parent: custom-page-shared-shell
summary: Let a package replace any internal Featherbase screen, component or service by name.
related:
  - custom-page
  - custom-block
---

# Arbitrary core overrides

## Question considered

Should trusted packages be able to replace any internal Featherbase component
or service while retaining framework upgrade support?

## Advantages

- Nearly any behavior can be changed without forking the repository.
- Applications can patch framework limitations immediately.

## Costs

- Internal names and implementation details become permanent public contracts.
- Upgrades cannot safely change core composition without reasoning about every
  possible replacement.
- Multiple packages can compete to replace the same internal surface.

## Decision and revisit condition

Rejected as an upgrade guarantee. Applications can own whole clients, custom
pages, custom blocks, routes and other documented extension points. A
self-hosted operator may still edit the core, but owns the resulting fork and
its upgrade work.

<!-- capability-catalog:start -->

## Connections

**Parent:** [Custom page in the shared shell](../packaging-and-escape-hatches/custom-page-shared-shell.md)

**Related capabilities:** [Custom](../page-intents/custom.md), [Custom block](../core-blocks/custom.md)

**Specifications:** Not yet written

**Tickets:** —

**Proving applications:** None recorded.

<!-- capability-catalog:end -->
