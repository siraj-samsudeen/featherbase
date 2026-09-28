# Design

## Context

Depends on the populated basic Todo application. See [proposal.md](proposal.md), [priority](specs/task-priority/spec.md) and [API contracts](specs/api-contracts/spec.md).

## Goals / Non-Goals

Introduce a required field safely and make endpoint contracts authoritative. No additional task fields or framework extraction.

## Decisions

Use two ordered application/schema revisions: nullable priority, then backfill and NOT NULL. Preserve the first as a usable revision so the second is a genuine populated upgrade. Use established migration tooling and a separate migration command rather than private bookkeeping or startup resets.

Derive clients and documentation from authoritative schemas. Validate actual response paths, including errors, rather than trusting casts or serializers. See [engineering requirements](../../../ENGINEERING.md) for technical guarantees.

## Risks / Trade-offs

Generated documentation can diverge from runtime behavior if handlers bypass checks. Boundary tests must exercise real handlers. Database backfill and history updates must not report partial work as complete.

## Migration Plan

Back up existing records, introduce null priorities, then preserve explicit values while backfilling only nulls. Verify fresh installation, populated upgrade, reruns and recovery. Do not assume a destructive down migration is safe.
