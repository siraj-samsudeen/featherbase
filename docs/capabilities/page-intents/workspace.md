---
id: workspace-page
kind: capability
title: Workspace
status: partial
order: 11
parent: page-intents
summary: A role-aware landing page of navigation, shortcuts, metrics, charts and important collections.
specifications:
  - dashboards-and-home-pages
issues:
  - 277
related:
  - metric-block
  - chart-block
  - collection-block
proving_applications:
  - Training
---

# Workspace

## Purpose

A Workspace is the application or module landing page. It answers what matters
now and where the current user can go next without requiring a custom homepage.

## Current scope

Featherbase already has generic home pages, dashboards, number cards, charts,
role-aware links, recents and activity. It is Partial because a runtime
application cannot yet declare and own a Workspace assembled from those pieces.

Training should prove this surface through its lesson ladder and learner
progress summary.

<!-- capability-catalog:start -->

## Sub-capabilities

No reusable sub-capabilities have been separated yet.

## Connections

**Parent:** [Page intents](./README.md)

**Related capabilities:** [Metric](../core-blocks/metric.md), [Chart](../core-blocks/chart.md), [Collection block](../core-blocks/collection.md)

**Specifications:** [dashboards-and-home-pages](../../../openspec/specs/dashboards-and-home-pages/spec.md)

**Tickets:** [#277](https://github.com/siraj-samsudeen/featherbase/issues/277)

**Proving applications:** Training

<!-- capability-catalog:end -->
