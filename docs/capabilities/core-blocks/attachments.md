---
id: attachments-block
kind: capability
title: Attachments
status: partial
order: 27
parent: core-blocks
summary: Authorized upload, listing, preview, download and removal of files attached to a record.
specifications:
  - files-and-sharing
issues:
  - 165
related:
  - files
  - record-page
proving_applications:
  - Training
---

# Attachments

## Purpose

The Attachments block gives records a consistent file surface governed by the
current user's permissions.

## Current scope

Core file operations exist. Applications do not yet have a declared block or a
complete package-facing file service, and production object storage remains
tracked separately.

<!-- capability-catalog:start -->

## Sub-capabilities

No reusable sub-capabilities have been separated yet.

## Connections

**Parent:** [Core blocks](./README.md)

**Related capabilities:** [Files](../runtime-services/files.md), [Record](../page-intents/record.md)

**Specifications:** [files-and-sharing](../../../openspec/specs/files-and-sharing/spec.md)

**Tickets:** [#165](https://github.com/siraj-samsudeen/featherbase/issues/165)

**Proving applications:** Training

<!-- capability-catalog:end -->
