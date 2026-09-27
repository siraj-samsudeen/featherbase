---
id: import-export-print
kind: capability
title: Import, export and print
status: partial
order: 49
parent: runtime-services
summary: Spreadsheet ingestion, tabular export and printable record or report views.
specifications:
  - spreadsheet-import
  - reports-and-charts
  - printing
related:
  - report-page
  - metadata-records
---

# Import, export and print

## Purpose

These services move governed application data across spreadsheet, tabular and
print boundaries without each application writing its own machinery.

## Current scope

The generic Admin supports all three. Runtime package contracts do not yet
expose them as one coherent application-facing service.

<!-- capability-catalog:start -->

## Sub-capabilities

No reusable sub-capabilities have been separated yet.

## Connections

**Parent:** [Runtime services](./README.md)

**Related capabilities:** [Report](../page-intents/report.md), [Metadata and records](./metadata-records.md)

**Specifications:** [spreadsheet-import](../../../openspec/specs/spreadsheet-import/spec.md), [reports-and-charts](../../../openspec/specs/reports-and-charts/spec.md), [printing](../../../openspec/specs/printing/spec.md)

**Tickets:** —

**Proving applications:** None recorded.

<!-- capability-catalog:end -->
