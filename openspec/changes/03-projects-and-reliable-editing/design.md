# Design

## Context

Depends on Todos with required priority and authoritative contracts. See [project behavior](specs/project-work/spec.md) and [reliable editing](specs/reliable-editing/spec.md).

## Goals / Non-Goals

Add Project organization and protect Todo intent across concurrency and network failure. Accounts and permissions are not part of this change.

## Decisions

Enforce references and version checks atomically on the server. Use durable creation identity to reconcile uncertain saves. Keep each unresolved operation's submitted values separate from newer editable values; blocking unrelated operations is an allowed simpler alternative to concurrent recovery.

Keep latest saved values distinct from proposed replacements. A version conflict is not an automatic merge or an instruction to discard the draft. UI filtering follows saved state immediately.

## Risks / Trade-offs

A lost reply differs from a rejected request: the database may already have changed. Recovery must establish the saved result before repeating a create. External launcher termination may leave the actual service alive; shutdown must target the real instance.

## Migration Plan

Add Projects, nullable Project references and open completion state without resetting existing records. Preflight existing title validity and request correction of invalid records instead of silently changing them.
