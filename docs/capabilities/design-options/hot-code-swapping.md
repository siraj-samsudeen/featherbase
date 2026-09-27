---
id: hot-code-swapping
kind: design-option
title: Hot code swapping
disposition: deferred
order: 86
parent: packaging-escape-hatches
summary: Replace running application code and transform live state without restarting the application runtime.
related:
  - runtime-application-package
  - notifications-jobs
---

# Hot code swapping

## Question considered

Should Featherbase reproduce BEAM releases that can load new code and migrate
live process state while the runtime remains active?

## Advantages

- Some upgrades can avoid process restart and reduce interruption.
- Versioned code and data migration boundaries encourage disciplined releases.

## Costs

- Live code and state compatibility greatly increases the number of upgrade
  states the framework and every application must support.
- Most customer-installed applications do not initially need continuous
  availability at that level.
- The complexity would arrive before ordinary installation, migration and
  restart semantics are proven.

## Decision and revisit condition

Deferred. Featherbase takes the useful BEAM/Phoenix separation of package,
migration, lifecycle, health and supervision boundaries, but starts with normal
process restarts. Revisit only for applications with measured availability
requirements that cannot tolerate the governed restart path.

<!-- capability-catalog:start -->

## Connections

**Parent:** [Packaging and escape hatches](../packaging-and-escape-hatches/README.md)

**Related capabilities:** [Runtime application package](../packaging-and-escape-hatches/runtime-application-package.md), [Notifications and jobs](../runtime-services/notifications-jobs.md)

**Specifications:** Not yet written

**Tickets:** —

**Proving applications:** None recorded.

<!-- capability-catalog:end -->
