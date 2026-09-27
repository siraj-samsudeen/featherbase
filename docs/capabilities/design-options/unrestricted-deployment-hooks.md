---
id: unrestricted-deployment-hooks
kind: design-option
title: Unrestricted deployment hooks
disposition: rejected
order: 85
parent: packaging-escape-hatches
summary: Let installed packages run arbitrary commands during deployment, installation and lifecycle transitions.
related:
  - runtime-application-package
  - notifications-jobs
---

# Unrestricted deployment hooks

## Question considered

Should a trusted application package be allowed to run any operating-system
command at any point in deployment?

## Advantages

- A package can integrate any tool without waiting for a framework contract.
- Existing deployment scripts can be reused directly.

## Costs

- Installation becomes difficult to preview, retry and support consistently.
- A package can mutate shared infrastructure outside Featherbase's lifecycle
  ledger and leave the installation in an unknown state.
- Customer-hosted and managed environments can diverge around undocumented
  assumptions.

## Decision and revisit condition

Rejected as the package contract. Featherbase provides migrations, declared
services and jobs, start and stop, configuration, health and named extension
points. Operators remain free to run deployment automation outside Featherbase,
but that automation is not a portable application capability.

<!-- capability-catalog:start -->

## Connections

**Parent:** [Packaging and escape hatches](../packaging-and-escape-hatches/README.md)

**Related capabilities:** [Runtime application package](../packaging-and-escape-hatches/runtime-application-package.md), [Notifications and jobs](../runtime-services/notifications-jobs.md)

**Specifications:** Not yet written

**Tickets:** —

**Proving applications:** None recorded.

<!-- capability-catalog:end -->
