---
id: collection-page
kind: capability
title: Collection
status: partial
order: 12
parent: page-intents
summary: A searchable, filterable, sortable and pageable set of records with saved views and actions.
specifications:
  - list-view
  - saved-views
related:
  - collection-block
  - record-page
  - queries-saved-views
proving_applications:
  - Tasker
---

# Collection

## Purpose

A Collection page lets a user find, compare and act on many records. Selection,
saved views, bulk actions and alternate projections belong to the same page
intent rather than separate application systems.

## Current scope

The generic Admin supplies the behavior. Runtime applications can call its APIs
from custom React, but cannot yet declare a Collection page and inherit the
complete interaction contract.

<!-- capability-catalog:start -->

## Sub-capabilities

No reusable sub-capabilities have been separated yet.

## Connections

**Parent:** [Page intents](./README.md)

**Related capabilities:** [Collection block](../core-blocks/collection.md), [Record](./record.md), [Queries and saved views](../runtime-services/queries-saved-views.md)

**Specifications:** [list-view](../../../openspec/specs/list-view/spec.md), [saved-views](../../../openspec/specs/saved-views/spec.md)

**Tickets:** —

**Proving applications:** Tasker

<!-- capability-catalog:end -->
