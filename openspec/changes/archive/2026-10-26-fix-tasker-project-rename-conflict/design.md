# Design

## Context

See proposal.md for motivation. `ProjectHeading` currently stores only an editing flag and name. Its effect replaces the name whenever the live project's name changes, and submission passes the live project to `renameProject`, which sends its `updated_at`. Both draft text and revision can therefore change during a refetch.

TaskDetail already snapshots title, description, and revision at edit start. Its real-server regression in `apps/web/test/task-management.test.tsx` performs a competing save and triggers query refresh through a composer mutation. The original method is recorded in thread T-01a0c40b-2c92-73da-b4b9-60acf76b2088, included in commit 775958a425ffd6dc9df0dc4357638027d46330ce.

## Goals / Non-Goals

**Goals:** Apply the existing draft snapshot pattern to project rename and prove conflict handling across a real refetch.

**Non-Goals:** No new server concurrency mechanism, dependency migration, changes to project descriptions, task editing, Admin UI, toolbar, or authentication.

## Decisions

- Keep project identity, name, and revision together in rename draft state, initialized only when editing starts. Submit the draft's revision, not the query cache's revision. Freezing just the revision would still let the current name-sync effect destroy typed input.
- Preserve the draft on errors; clear it on successful save or Cancel. Key the project heading by selected project identity so an old draft cannot be applied after navigation. Reopening rename starts from the then-current project.
- Reuse the existing parent error display and real server's conflict response; do not invent a parallel conflict protocol or retry stale writes automatically.
- Extend the existing real-Postgres component suite. Save a competing project name, trigger refresh through adding a project task, and explicitly witness the newer project name outside the draft before submitting. Assert conflict, preserved draft, and persisted competing name. Keep existing successful-rename coverage and test Cancel/reopen with the refreshed revision.
- Use the Session DSL for a scoped browser proof of the same flow against an installed Tasker package, with real competing HTTP writes and persisted readback. Do not copy the old raw-Playwright acceptance script's browser action style.

## Risks / Trade-offs

- A test that saves before the refresh settles would pass the old implementation → wait for observable refreshed project data before submission.
- Project navigation can reuse local state → key the heading by project identity and verify a new project does not inherit the draft.
- Retrying an unchanged stale draft still conflicts → Cancel and reopen intentionally starts a fresh edit; no automatic rebasing.

## Migration Plan

No database or API migration. Build the runtime package for verification. Revert the scoped client change if necessary.
