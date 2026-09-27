---
id: application-extraction-import
kind: capability
title: Application extraction and import
status: not-started
order: 65
parent: packaging-escape-hatches
summary: Move one application's definitions, data, files and configuration between shared and dedicated installations.
related:
  - runtime-application-package
  - files
---

# Application extraction and import

## Purpose

An application may begin beside other applications in one customer installation
and later need its own server. Extraction and import preserve the option to move
it without redesigning the package or abandoning its owned data.

The reverse operation should also be possible: an independently developed app
can be brought into an installation when its package contract and dependencies
are compatible.

## Current scope

Package ownership and additive upgrades exist. The transfer manifest,
dependency checks, data selection, file movement, configuration handling and
verification contract are not yet specified.

<!-- capability-catalog:start -->

## Sub-capabilities

No reusable sub-capabilities have been separated yet.

## Connections

**Parent:** [Packaging and escape hatches](./README.md)

**Related capabilities:** [Runtime application package](./runtime-application-package.md), [Files](../runtime-services/files.md)

**Specifications:** Not yet written

**Tickets:** —

**Proving applications:** None recorded.

<!-- capability-catalog:end -->
