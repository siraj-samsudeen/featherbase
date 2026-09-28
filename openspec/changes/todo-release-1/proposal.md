# Proposal

## Why

Compare six substrates for an agent-oriented declarative CRUD framework using the same real application before proposing any framework. Release 1 establishes observable Todo behavior, not a preferred implementation architecture.

## What Changes

- Propose a persisted, unauthenticated Todo application with PostgreSQL, discoverable JSON HTTP functionality, accessible responsive interaction, and explicit failure and concurrency outcomes.
- Gates 1 and 2 are approved. The owner requested simpler wording without changing behavior and authorized candidate launch after suite validation and opening the contract PR, without another review wait.
- Evaluate React/Vite + Elysia/Bun, React/Vite + Fastify/Node, React/Vite + Hono, React/Vite + Axum, Leptos + Axum, and React/Vite + Encore.ts against identical approved behavior in later gates.

Every candidate must install and use OpenSpec and follow the same approved requirements. Stack-specific plans cannot weaken them. Behavior changes need manager review and owner approval. These are benchmark rules, not user scenarios.

## Capabilities

### New Capabilities

- `todo`: Release-1 user behavior, public machine contract, durable storage, and migration expectations.

### Modified Capabilities

None. This branch starts without Featherbase code or inherited product requirements.

## Impact

This branch holds OpenSpec planning and the external acceptance suite, not candidate application code. Candidate routes, response envelopes, project structure, state and schema libraries, data access, client generation, components, rendering strategy, and internal layers remain unconstrained. No authentication, Projects, reusable CRUD framework, resource DSL, generic repository, plugin system, deployment, or speculative abstraction belongs in release 1.

Gate 3 validates the external suite and opens its PR, then six Medium-mode workers may start. Stop for owner review of the independently tested Gate-4 comparison. Gates 5–7 cover incremental Projects, extraction proposals, and approved finalist extraction respectively, each with its own approval stop. OpenSpec artifact completion never substitutes for those approvals.
