# Proposal

## Why

Compare six substrates for an agent-oriented declarative CRUD framework using the same real application before proposing any framework. Release 1 establishes observable Todo behavior, not a preferred implementation architecture.

## What Changes

- Propose a persisted, unauthenticated Todo application with PostgreSQL, discoverable JSON HTTP functionality, accessible responsive interaction, and explicit failure and concurrency outcomes.
- Gate 1 is approved. The owner subsequently requested simpler wording without changing behavior. Gate 2 remains proposed; no implementation or worker launch is authorized yet.
- Evaluate React/Vite + Elysia/Bun, React/Vite + Fastify/Node, React/Vite + Hono, React/Vite + Axum, Leptos + Axum, and React/Vite + Encore.ts against identical approved behavior in later gates.

Every candidate must install and use OpenSpec and follow the same approved requirements. Stack-specific plans cannot weaken them. Behavior changes need manager review and owner approval. These are benchmark rules, not user scenarios.

## Capabilities

### New Capabilities

- `todo`: Release-1 user behavior, public machine contract, durable storage, and migration expectations.

### Modified Capabilities

None. This branch starts without Featherbase code or inherited product requirements.

## Impact

Only OpenSpec tooling and planning documents exist here. Candidate routes, response envelopes, project structure, state and schema libraries, data access, client generation, components, rendering strategy, and internal layers remain unconstrained. No authentication, Projects, reusable CRUD framework, resource DSL, generic repository, plugin system, deployment, or speculative abstraction belongs in release 1.

Gate 2 will propose scoring, acceptance design, semantic UI selectors, isolated databases, lifecycle controls, and measurements. Gate 3 implements and validates the external suite. Only explicit Gate-3 approval permits six independent workers at Gate 4. Gates 5–7 cover incremental Projects, extraction proposals, and approved finalist extraction respectively, each with its own approval stop. OpenSpec artifact completion never substitutes for those approvals.
