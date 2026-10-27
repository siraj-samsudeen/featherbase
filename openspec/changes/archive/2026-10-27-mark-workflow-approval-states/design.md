# Design

## Context

See proposal.md. The shared notifier infers approval from outgoing actions. The generic sub-table grid currently uses text inputs for every column, so it also needs checkbox rendering for Check metadata.

## Goals / Non-Goals

Gate approval email centrally without changing who can take actions. Do not implement the initial-row notifier owned by PR #585.

## Decisions

Add waits_for_approval as a Check on Workflow Document State through migration 0134, after target_status, with default false and in_list_view enabled. Read it with the workflow states and return before recipient lookup for an unmarked state. Use the same notifier for the later PR #585 integration. No custom Workflow UI is needed; the generic child grid renders Check columns as boolean checkboxes.

Extend the bootstrap schema readiness probe to the new column, because earlier migrations save rows before all Workflow columns exist.

## Risks / Trade-offs

Existing workflows stop emailing until states are marked: this is the owner's explicit opt-in decision. Migration must preserve marks on a repeated run. PR #585 fixtures will need the explicit mark when it is integrated.

## Migration Plan

Rehearse 0134 on a disposable restored database, run it on an existing database and a fresh install, and prove the generic form saves and reopens the flag. Deployment follows docs/DEPLOY.md. A code rollback requires reviewing email behavior because old code emails unmarked states.
