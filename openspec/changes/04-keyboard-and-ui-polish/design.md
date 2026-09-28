# Design

## Context

All existing Todo, Project and recovery flows need consistent interaction. See [usability requirements](specs/task-usability/spec.md).

## Goals / Non-Goals

Improve keyboard efficiency, current feedback and responsive accessibility without changing business data or introducing new features.

## Decisions

Use reusable accessible controls and common visual tokens. Make focus transitions explicit after removed controls and rendered editors; a disabled create input cannot be a recovery focus target. Prefer state-specific feedback rather than accumulating independent status strings.

Verify input-level Enter/Escape and focus after rendering settles. Include pending, invalid, uncertain and conflict states in visual inspection, not only the default list.

## Risks / Trade-offs

Automated accessibility checks cover only part of usability. Real screen-reader behavior, browser zoom and contrast require direct checks; missing checks cannot be represented as certification. No database migration is needed.
