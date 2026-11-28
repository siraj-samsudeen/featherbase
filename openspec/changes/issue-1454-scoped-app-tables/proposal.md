## Why

An app whose reads are scoped by the org chart (person_scope) could keep its read-only copies to each reader's places,
but not its own Tables: those were read through role grants, so a review Table was either readable by everyone or by
no one. Forecasting needs both kinds kept to the same places, with no per-person grants (#1454).

## What Changes

- An app may declare some of its own Tables as **scoped Tables**, mapped on the same scope filters as a dataset. Its
  person_scope reads list their rows within the reader's places, and the platform, not the app, decides which rows.
- A **validator reads its app's read-only copies as the app**, whole, so it can check a save against the Run's line
  for someone who may read only their places of the copy, or none of it.

## Impact

- Platform: `apps/server/src/app-scoped-tables.ts` (new), `runtime-actions.ts`, `runtime-packages.ts`, `shared`.
- Apps: Forecasting 0.14.0 is the first to declare scoped Tables.
