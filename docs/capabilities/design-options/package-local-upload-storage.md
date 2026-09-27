---
id: package-local-upload-storage
kind: design-option
title: Package-local upload storage
disposition: rejected
order: 91
parent: files
summary: Let each application store ordinary customer uploads directly inside its own package directory.
related:
  - attachments-block
  - runtime-application-package
---

# Package-local upload storage

## Question considered

Should an application write uploaded workbooks and attachments beside its own
code and packaged assets?

## Advantages

- The first local implementation is simple.
- An application can choose storage behavior without waiting for the framework.

## Costs

- Deployments can replace or discard mutable files stored beside code.
- Authorization, backup, migration and extraction become inconsistent across
  applications.
- Moving from local disk to object storage requires application changes.

## Decision and revisit condition

Rejected as the default. Package assets are read-only; customer uploads use the
Featherbase file service, with local disk for development and persistent or
object storage for production. A documented specialist-storage escape hatch
remains available when an application's storage semantics genuinely differ.

<!-- capability-catalog:start -->

## Connections

**Parent:** [Files](../runtime-services/files.md)

**Related capabilities:** [Attachments](../core-blocks/attachments.md), [Runtime application package](../packaging-and-escape-hatches/runtime-application-package.md)

**Specifications:** Not yet written

**Tickets:** —

**Proving applications:** None recorded.

<!-- capability-catalog:end -->
