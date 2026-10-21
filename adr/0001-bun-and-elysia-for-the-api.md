# 0001. Bun and Elysia for the API

- Status: accepted
- Date: 2026-10-21

## Context

The rewrite needs a runtime and an HTTP framework. The elysia-learning branch already built a
to-do API on Bun and Elysia, and the team has learned that stack.

## Decision

The API runs on Bun and is built with Elysia. Tests use `bun test` and call the app in-process
through `app.handle()`.

## Consequences

- One tool for runtime, tests and packages; no separate test runner or bundler.
- Elysia's end-to-end types (Eden) are available for a future typed client.
- Tooling that assumes Node (some mutation-testing runners, TypeScript plugins) needs checking
  on Bun before adoption.
