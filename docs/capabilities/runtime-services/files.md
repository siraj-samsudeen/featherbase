---
id: files
kind: capability
title: Files
status: partial
order: 46
parent: runtime-services
summary: Authorized upload, download and attachment behavior with pluggable durable storage.
specifications:
  - files-and-sharing
issues:
  - 165
related:
  - attachments-block
  - runtime-application-package
proving_applications:
  - Training
---

# Files

## Purpose

Package assets are read-only application content. Customer uploads use the
Featherbase file service so authorization, ownership and storage can evolve
without changing application code.

## Current scope

Disk-backed file operations are suitable for local development. Production
needs persistent or object storage, while specialist applications retain an
explicit app-owned storage escape hatch when the shared service is unsuitable.

<!-- capability-catalog:start -->

## Sub-capabilities

No reusable sub-capabilities have been separated yet.

## Connections

**Parent:** [Runtime services](./README.md)

**Related capabilities:** [Attachments](../core-blocks/attachments.md), [Runtime application package](../packaging-and-escape-hatches/runtime-application-package.md)

**Specifications:** [files-and-sharing](../../../openspec/specs/files-and-sharing/spec.md)

**Tickets:** [#165](https://github.com/siraj-samsudeen/featherbase/issues/165)

**Proving applications:** Training

<!-- capability-catalog:end -->
