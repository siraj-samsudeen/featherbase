# ADR Review Manifest

- Status: completed
- Review date: 2026-11-04

## Review Summary

Retiring a row adds standard columns to every stored Table and a platform-wide rule that list
reads hide retired rows. That is a durable, project-wide decision a later builder could
reasonably contest (adding their own active column instead), so it is recorded as
[ADR 0019](../../../adr/0019-retiring-a-row-is-a-platform-standard.md).

## In-Force ADR Context

Everything derives from Table metadata and all writes go through the server (AGENTS.md
architecture invariants); record identity (0009); platform, apps and instances are separate
layers (0011, 0014); ADRs are never edited (0015). None is changed.

## New Durable ADRs Created

- 0019 Retiring a row is a platform standard.
