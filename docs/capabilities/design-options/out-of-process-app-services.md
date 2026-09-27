---
id: out-of-process-app-services
kind: design-option
title: Out-of-process application services
disposition: deferred
order: 90
parent: notifications-jobs
summary: Start every application service as a separate worker or process from the first version.
related:
  - runtime-application-package
---

# Out-of-process application services

## Question considered

Should package-declared services always run outside the main Featherbase server?

## Advantages

- Failures and resource use can be isolated by process.
- Services can scale and restart independently.
- Different runtime requirements become easier to host separately.

## Costs

- Every installation immediately needs orchestration, inter-process transport,
  health aggregation and deployment coordination.
- Small customer-installed applications pay operational complexity before they
  need independent scaling.

## Decision and revisit condition

Deferred. Services begin in-process behind explicit start, stop, health and
configuration boundaries. Those boundaries preserve the option to move a
service to a worker when isolation or scale warrants it, without changing the
application package contract.

<!-- capability-catalog:start -->

## Connections

**Parent:** [Notifications and jobs](../runtime-services/notifications-jobs.md)

**Related capabilities:** [Runtime application package](../packaging-and-escape-hatches/runtime-application-package.md)

**Specifications:** Not yet written

**Tickets:** —

**Proving applications:** None recorded.

<!-- capability-catalog:end -->
