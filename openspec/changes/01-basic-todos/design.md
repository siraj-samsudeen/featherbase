# Design

## Context

The application starts with only a Todo identity and title. See [proposal.md](proposal.md) and the [behavior spec](specs/basic-todos/spec.md).

## Goals / Non-Goals

Provide a small vertical slice from browser through HTTP to PostgreSQL. Do not introduce future fields, generic resource abstractions or conflict workflows.

## Decisions

Use server-owned persistence and a stable database identity rather than browser storage or titles as keys. Keep UI and HTTP operations aligned. Routes and internal organization are implementation choices. Document setup and ordinary API calls.

## Risks / Trade-offs

The initial application does not protect against competing edits. This is deliberate release scope; reliable editing is introduced later. Safe SQL and literal text rendering apply from the start.
