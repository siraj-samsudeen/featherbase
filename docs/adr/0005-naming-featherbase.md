# ADR 0005: Name — Featherbase

**Status:** Accepted · **Date:** 2026-07-08

## Context

The project needed a name fitting Siraj's existing **feather** ecosystem (feather-testing-core, feather-testing-convex, the feather-flow tooling). Constraint discovered during the check: **FeathersJS** is a long-established Node.js framework (`feathers` on npm), so the bare word "feather" was never safe for a JS framework; bare `feather` is also a taken npm package.

## Decision

**Featherbase.** npm-available at check time (2026-07-08), packages scoped as `@featherbase/*` (e.g. `@featherbase/core`, `@featherbase/flows`).

## Why

The only candidate that both extends the existing feather brand and describes the category (`-base` signals the Airtable/Supabase-adjacent data platform). Clearly distinct from FeathersJS. The promotion ladder gets a natural vocabulary for free: a runtime table _fledges_ into code.

## Alternatives considered

| Name                              | npm at check | Rejected because                                   |
| --------------------------------- | ------------ | -------------------------------------------------- |
| Featherstack                      | available    | Accurate but generic                               |
| Calamus (a feather's quill shaft) | available    | Elegant but obscure; abandons feather brand equity |
| Quillbase                         | available    | Diverges from the feather-* ecosystem name         |
| Feather / Fledge / Plume / Pluma  | taken        | npm collisions; FeathersJS adjacency               |
