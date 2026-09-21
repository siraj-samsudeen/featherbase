# Issue #296 — Build a shared task-management prototype

## Context

The Ramachandran DWT team needs a real task surface to learn from actual work rather than continuing to design from imagined cases. Featherbase already owns native metadata-backed Tables, generic Row CRUD, comments, history, users, permissions and server-side per-user settings. This change combines those primitives into one installable sample app and one task-focused Admin surface.

The prototype is deliberately a complete vertical slice: quick capture, Inbox triage, project entry, personal tasks, single responsibility, task state, shared urgency and private ordered focus. It does not turn Featherbase into a general project-planning suite.

## Decisions locked in

- Every signed-in team member sees and may edit every task and project.
- Quick capture requires a title only and creates an unassigned Inbox task.
- A task has one destination: Inbox, one team project, or one user’s team-visible Personal tasks.
- A Personal tasks destination assigns its owner; project tasks remain unassigned until somebody takes or delegates them.
- A task has at most one responsible person. Assignment and work state are independent.
- States are Not started, In progress, Blocked, On hold, Done and Cancelled.
- A completion checkbox is a shortcut to Done; undo restores the preceding state.
- Description is current context; comments are dated discussion. Deliberate inactive states offer an optional comment.
- Urgent is a shared binary signal. Star and focus order are private per-user settings and never assign a task.
- My Work shows ordered My Focus, then remaining tasks assigned to the user, without duplicates.
- The app uses native metadata Tables and app hooks; a task-focused workspace composes them without replacing Featherbase’s generic Table/Form surfaces.
- The existing multi-assignee `ToDo` facility is not the domain owner. A nullable `assigned_to` Reference on Team Task enforces the one-responsible-person rule.
- Personal tasks are derived from the chosen User rather than separate list Rows; no empty personal-list administration is required.
- The first prototype orders triage deterministically by urgent first, then oldest, solely as a reversible default pending real-use feedback.

## Files

**Create:**

- `docs/specs/0010-task-management.md` — signed user journeys, rules, invariants and deferred scope.
- `apps/server/src/sample-apps/task-management.ts` — installable Team Project and Team Task metadata plus lifecycle invariants.
- `apps/server/test/task-management-app.test.ts` — real-Postgres contract and property cases.
- `apps/web/src/pages/TaskManagement.tsx` — quick capture, Inbox triage, project entry and My Work.
- `apps/web/test/task-management.test.tsx` — component journeys against the in-process server.
- `apps/web/e2e/task-management.spec.ts` — browser-only keyboard, layout and persistence walk.

**Modify:**

- `apps/server/src/index.ts` — register the opt-in task-management app.
- `apps/web/src/router.tsx` — add the authenticated task workspace route.
- `docs/specs/README.md` — index spec 0010.
- `PROGRESS.md` — append verification evidence after implementation.

**Delete:** none.

**Reuse unchanged:**

- Generic Table and Row APIs — all shared task data uses the normal lifecycle and optimistic concurrency.
- `Comment`, `File`, `Version` and their existing UI — no parallel notes system.
- `User` References — both destination owner and responsible person point at existing users.
- `/api/user_settings/:table` — stores the caller’s ordered focus task IDs privately and durably.
- Realtime list/Row invalidation — shared task edits use the existing publication path.

## Design

### Native application model

The `task-management` AppManifest owns two Tables under module `Tasks`:

- **Team Project** — `project_name` only, with generated identity and title column.
- **Team Task** — title, description, state, completion checkbox, shared urgent flag, optional project, optional Personal tasks owner, optional responsible person, and hidden prior-state storage for completion undo.

These global names were a prototype precaution, not app-scoped identity.
Correction (21-Sep-2026): installation calls `createTable`, which rejects an
existing Table name; it does **not** adopt that Table. The runtime slice below
supersedes these names with `tasker.task` and `tasker.project`, with explicit
physical storage metadata. The old local prototype requires a deliberate,
data-preserving transition rather than adoption by matching display label.

The manifest grants the implicit `All` role read/write/create/delete on both Tables. This matches the settled trusted-team scope without requiring role assignment before the prototype is usable.

### Lifecycle invariants

`before_validate` on Team Task:

- rejects simultaneous project and Personal tasks owner;
- when Personal tasks owner is set, sets the responsible person to that owner;
- keeps assignment changes independent of state;
- maps completion tick to Done while retaining the previous non-Done state;
- maps completion undo back to that retained state;
- keeps direct state changes and the checkbox coherent.

These rules live server-side so generic Form/API writes cannot bypass the workspace contract.

### Task workspace

`/admin/tasks` is an application workspace, not a second hand-written Form. It composes ordinary Table APIs into four focused views:

1. **Inbox** — quick title capture plus one-at-a-time triage.
2. **My Work** — private ordered My Focus followed by assigned, unstarred tasks.
3. **Projects** — name-only creation, project selection and rapid task-title entry.
4. **Personal tasks** — the signed-in user’s destination, with other users selectable for team review.

Task detail links to the generic Team Task Form for full description, attachments, comments and history. The workspace itself owns only the cross-Table journey and lightweight task actions.

Private focus is an ordered `row_id[]` in the caller’s `user_settings` under a dedicated `Task Management Focus` key. Reads resolve only currently readable Team Tasks; writes remove stale IDs. Move-up/move-down controls provide the first keyboard-accessible manual ordering; drag-and-drop is not required for the prototype.

### Navigation

The app ships a Home Page fixture with a URL shortcut to `/admin/tasks` and ordinary Table links for Team Project and Team Task. Installing the app therefore creates a visible entry point without hard-coding it into every deployment.

## Tests

Server integration tests prove:

- install/uninstall ownership;
- title-only Inbox defaults;
- all destination combinations, including rejection of the impossible combination;
- Personal tasks owner implies matching responsible person;
- assignment does not change state;
- completion/undo restores an asymmetric prior state (In progress, not the default);
- direct Done/Cancelled changes keep completion coherent;
- every member can read and edit shared Rows.

Component tests prove the workspace’s core data journey and private focus no-duplication behavior. Playwright proves keyboard capture, navigation, one-at-a-time triage, focus persistence after reload and a representative phone-width layout.

## End-to-end verification

### (a) Happy path

```bash
pnpm --filter server test -- task-management-app.test.ts
pnpm --filter web test -- task-management.test.tsx
pnpm --filter web e2e -- task-management.spec.ts
```

Expected: each focused suite passes; the browser walk captures an Inbox task, triages it, creates project tasks, stars/reorders work and reloads without losing focus.

### (b) Edge cases

```bash
pnpm --filter server test -- task-management-app.test.ts -t "destination|completion|assignment"
```

Expected: impossible dual destination is rejected; a Personal tasks destination assigns its owner; undo restores In progress; assignment leaves state unchanged.

### (c) Failure path and repository checks

```bash
pnpm check:evidence
pnpm --filter server typecheck
pnpm --filter web typecheck
pnpm smoke
```

Expected: evidence linkage, both typechecks and existing smoke journeys pass with no skipped task-management obligation represented as proven.

## Out of scope

- Bulk Inbox editing.
- Due dates, reminders, overdue logic and recurring tasks.
- Dependencies, subtasks, time tracking and workload planning.
- Private tasks; Personal tasks are team-visible.
- Inbox-order product decisions beyond the reversible prototype default.
- General dynamic frontend-route registration for every installable app.
