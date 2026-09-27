---
id: record-page
kind: capability
title: Record
status: partial
order: 13
parent: page-intents
summary: One record viewed, created or edited with fields, relations, actions, history and attachments.
specifications:
  - core-forms
  - tables-and-fields
related:
  - field-group-block
  - relation-child-grid-block
  - activity-timeline-block
  - attachments-block
proving_applications:
  - tasker
  - training
---

# Record

## Purpose

A Record page is the standard surface for one metadata-defined record. View,
create and edit are modes of the same page rather than different systems.

## Current scope

Generic record editing, validation, relations and child rows already exist.
The capability is Partial until an installed application can compose and own
that page declaratively.

<!-- capability-catalog:start -->

## Sub-capabilities

No reusable sub-capabilities have been separated yet.

## Connections

**Parent:** [Page intents](./README.md)

**Related capabilities:** [Field group](../core-blocks/field-group.md), [Relation and child grid](../core-blocks/relation-child-grid.md), [Activity timeline](../core-blocks/activity-timeline.md), [Attachments](../core-blocks/attachments.md)

**Specifications:** [core-forms](../../../openspec/specs/core-forms/spec.md), [tables-and-fields](../../../openspec/specs/tables-and-fields/spec.md)

**Tickets:** —

**Proving applications:** [Tasker](../proving-applications/tasker.md), [Training](../proving-applications/training.md)

<!-- capability-catalog:end -->
