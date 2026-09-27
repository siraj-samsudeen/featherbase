---
id: authentication-permissions
kind: capability
title: Authentication and permissions
status: available
order: 42
parent: runtime-services
summary: Accounts, sessions, roles and table-, row- and field-level authorization.
specifications:
  - sign-in-and-accounts
  - permissions-and-roles
related:
  - runtime-application-package
  - custom-page-shared-shell
proving_applications:
  - tasker
  - training
---

# Authentication and permissions

## Purpose

Applications share one identity and authorization model rather than defining
their own login, role and row-access systems.

## Current scope

Accounts, sessions, roles and data permissions are available. Training should
reuse them for teacher, teaching-assistant and learner access.

<!-- capability-catalog:start -->

## Sub-capabilities

No reusable sub-capabilities have been separated yet.

## Connections

**Parent:** [Runtime services](./README.md)

**Related capabilities:** [Runtime application package](../packaging-and-escape-hatches/runtime-application-package.md), [Custom page in the shared shell](../packaging-and-escape-hatches/custom-page-shared-shell.md)

**Specifications:** [sign-in-and-accounts](../../../openspec/specs/sign-in-and-accounts/spec.md), [permissions-and-roles](../../../openspec/specs/permissions-and-roles/spec.md)

**Tickets:** —

**Proving applications:** [Tasker](../proving-applications/tasker.md), [Training](../proving-applications/training.md)

<!-- capability-catalog:end -->
