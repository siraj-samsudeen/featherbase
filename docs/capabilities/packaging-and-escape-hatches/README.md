---
id: packaging-escape-hatches
kind: capability-group
title: Packaging and escape hatches
status: partial
order: 60
summary: Portable application ownership, governed lifecycle and ordinary-code extension points.
related:
  - runtime-services
  - page-intents
alternatives:
  - shared-multitenant-saas-runtime
  - unrestricted-deployment-hooks
  - hot-code-swapping
---

# Packaging and escape hatches

## Purpose

Featherbase is a repository customers can clone, extend and run—not a shared
multitenant SaaS that retains ownership of their applications. The same package
shape should work inside a Featherbase clone or in an external repository, and
under customer-hosted or managed operation.

## Ownership and deployment boundary

The initial boundary is one customer per deployment. An application may model
multiple legal companies inside that deployment; this is different from placing
unrelated customers in one shared runtime.

Applications own their definitions, code, migrations, files and data boundaries
so they can move from a shared customer installation to a dedicated instance and
back through explicit extraction and import.

## Governed lifecycle

Packages receive migrations, declared services and jobs, start and stop, health
and configuration boundaries—not unrestricted deployment hooks. Services begin
in-process but keep a lifecycle seam for future workers. This takes the useful
separation of releases, supervision and migrations found in BEAM/Phoenix without
making hot code swapping an initial product requirement.

## Trade-off context

The README keeps the balanced comparisons that led to this boundary:

- [Shared SaaS or customer-owned deployment](../../../README.md#shared-saas-or-customer-owned-deployment)
- [Governed extension platform or trusted application code](../../../README.md#governed-extension-platform-or-trusted-application-code)
- [Generated application or durable runtime declaration](../../../README.md#generated-application-or-durable-runtime-declaration)

<!-- capability-catalog:start -->

## Sub-capabilities

| Capability | Status | Description | Specifications | Tickets |
| --- | --- | --- | --- | --- |
| [Runtime application package](./runtime-application-package.md) | ✓ Available | An additively upgradeable unit owning tables, migrations, actions, roles and an optional custom client. | [trusted-runtime-packages](../../../openspec/specs/trusted-runtime-packages/spec.md) | — |
| [Whole custom client](./whole-custom-client.md) | ✓ Available | An ordinary React client shipped by a trusted package for behavior outside the standard page model. | [trusted-runtime-packages](../../../openspec/specs/trusted-runtime-packages/spec.md) | — |
| [Custom page in the shared shell](./custom-page-shared-shell.md) | ◇ Planned | A package-owned React page retaining Featherbase navigation, identity and runtime services. | Not yet written | [#277](https://github.com/siraj-samsudeen/featherbase/issues/277) |
| [Namespaced server route](./namespaced-server-route.md) | ◇ Planned | An authenticated package-owned HTTP endpoint for behavior that does not fit a transactional action. | Not yet written | [#274](https://github.com/siraj-samsudeen/featherbase/issues/274) |
| [Application extraction and import](./application-extraction-import.md) | ○ Not started | Move one application's definitions, data, files and configuration between shared and dedicated installations. | Not yet written | — |

## Connections

**Related capabilities:** [Runtime services](../runtime-services/README.md), [Page intents](../page-intents/README.md)

**Specifications:** Not yet written

**Tickets:** —

**Proving applications:** None recorded.

## Design options

- [Shared multitenant SaaS runtime](../design-options/shared-multitenant-saas-runtime.md) — **Deferred.** Operate unrelated customers inside one provider-owned Featherbase application runtime and database boundary.
- [Unrestricted deployment hooks](../design-options/unrestricted-deployment-hooks.md) — **Rejected.** Let installed packages run arbitrary commands during deployment, installation and lifecycle transitions.
- [Hot code swapping](../design-options/hot-code-swapping.md) — **Deferred.** Replace running application code and transform live state without restarting the application runtime.

<!-- capability-catalog:end -->
