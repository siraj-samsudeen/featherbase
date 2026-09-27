---
id: notifications-jobs
kind: capability
title: Notifications and jobs
status: partial
order: 48
parent: runtime-services
summary: Email, webhooks, queued work, schedules, retries and application health.
specifications:
  - notifications-email-and-webhooks
  - background-and-scheduled-jobs
issues:
  - 284
related:
  - runtime-application-package
  - transactional-actions
---

# Notifications and jobs

## Purpose

Applications reuse one operational service for asynchronous work and outward
notifications rather than introducing independent schedulers and retry loops.

## Current scope

The platform services exist. The portable contract for app-owned jobs, validated
configuration, readiness and health remains incomplete. Initial app services
run in-process behind a lifecycle boundary so a future worker split does not
change the package contract.

<!-- capability-catalog:start -->

## Sub-capabilities

No reusable sub-capabilities have been separated yet.

## Connections

**Parent:** [Runtime services](./README.md)

**Related capabilities:** [Runtime application package](../packaging-and-escape-hatches/runtime-application-package.md), [Transactional actions](./transactional-actions.md)

**Specifications:** [notifications-email-and-webhooks](../../../openspec/specs/notifications-email-and-webhooks/spec.md), [background-and-scheduled-jobs](../../../openspec/specs/background-and-scheduled-jobs/spec.md)

**Tickets:** [#284](https://github.com/siraj-samsudeen/featherbase/issues/284)

**Proving applications:** None recorded.

<!-- capability-catalog:end -->
