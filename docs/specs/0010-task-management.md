# Feature: Shared task management

**IDs:** `TSK-J*` journeys · `TSK-R*` rules · `TSK-I*` invariants · `TSK-H*` hazards
**Provenance:** [issue #296](https://github.com/siraj-samsudeen/featherbase/issues/296), clarified with the Ramachandran DWT team owner before implementation.

## The jobs

**TSK-J1 — “I have something in mind. Let me capture it now and decide where it belongs later.”**

**TSK-J2 — “We are reviewing a project. Let us add work quickly, then let one person take responsibility when the team is ready.”**

**TSK-J3 — “I am starting my day. Let me pull a personal shortlist from every project and arrange what I will look at first.”**

## Prior state

A signed-in member of one trusted team. Every member may see and edit every task and project. The app starts with no projects or tasks; each user’s Personal tasks list is derived from that user rather than created as a separate administrative record.

## TSK-J1 — Capture, then triage

> evidence: proven — component and browser walks capture neutral Inbox work,
> move it to Personal tasks, and preserve its state and assignment rules.

| # | Where / do | Must observably see | Bug if | Rules |
|---|---|---|---|---|
| J1.1 | Task home — type a short title into Quick capture and press Enter | The task appears in Inbox immediately, unassigned, with no project | Capture asks for a project or silently assigns the author | R1, R2 |
| J1.2 | Open Inbox triage | One captured task with its title, author and current shared signals; the remaining count is visible | Triage loses the capture context or changes the task merely by opening it | R1 |
| J1.3 | Choose a team project and optionally choose a responsible person | Save and next removes the task from Inbox, preserves the optional assignment, and opens the next item | Moving to a project invents an assignee | R2, R3 |
| J1.4 | On another Inbox item choose My Personal tasks | The item leaves Inbox and appears under the user’s Personal tasks, assigned to that user | A personal-list task remains unassigned or becomes private | R3, I1 |

**Branch at J1.3 — no destination yet.** Keep in Inbox leaves the task unchanged and advances only when the user chooses to skip it.

**Isolation:** install the task app in the journey database, create journey-owned rows, and uninstall the app after the walk.

## TSK-J2 — Project review and responsibility

> evidence: proven — the real browser creates a project and enters an
> unassigned task without leaving the project workspace.

| # | Where / do | Must observably see | Bug if | Rules |
|---|---|---|---|---|
| J2.1 | Task home — create a project from its name alone | The project opens ready for tasks | Creation requires dates, an owner or a description | R4 |
| J2.2 | Inside the project, enter three task titles with Enter between them | Three unassigned, Not started tasks appear without leaving the project | Rapid entry opens three full forms or assigns the author | R1, R4 |
| J2.3 | Assign one task to another member | That member is the sole responsible person; the task remains Not started | Assignment marks work In progress or leaves two responsible people | R5, I2 |
| J2.4 | The responsible person changes the task to In progress | Ownership stays unchanged and the work state changes | Starting work and accepting ownership are the same operation | R5 |
| J2.5 | Tick the task’s completion checkbox, then undo the mistaken tick | Tick shows Done; undo restores In progress | Undo always resets to Not started | R6 |
| J2.6 | Put another task On hold and add an optional explanation | The task shows On hold and the explanation appears as a dated comment | The explanation is mandatory or overwrites the description | R6, R7 |

**Branch at J2.3 — self-service pull.** An unassigned task may be assigned to the signed-in user without changing its state.

**Isolation:** the journey creates its own project and users after installing the app; app uninstall removes the app-owned Tables and rows.

## TSK-J3 — Personal daily focus

> evidence: proven — the real browser stars work and reloads My Work; the
> component walk proves ordered focus, no duplicates and no shared-row mutation.

| # | Where / do | Must observably see | Bug if | Rules |
|---|---|---|---|---|
| J3.1 | Review tasks across two projects; mark one urgent for the team | Urgent is visible as a shared task signal to every user | Urgent becomes a personal preference | R8 |
| J3.2 | Star an urgent task, a normal task and an unassigned task | All three appear in My Focus; no assignment changes | Starring accepts responsibility or requires an assignment | R9, I3 |
| J3.3 | Open My Work | My Focus appears first in personal order; Assigned to me follows and excludes tasks already in My Focus | A focused assigned task appears twice | R9, R10 |
| J3.4 | Reorder the focused tasks, then unstar the normal assigned task | The new order survives reload; the unstarred task moves to Assigned to me | One user’s order changes another user’s focus | R9, H1 |

**Branch at J3.4 — task owned by someone else.** Unstarring removes it from My Work entirely; it remains unchanged in its shared project.

**Isolation:** use two signed-in users so the journey can prove that stars and focus order are private while tasks and urgency are shared.

## Closure sweep

- **actors and permissions:** every signed-in team member may read, create and edit every task and project; personal focus preferences remain caller-owned.
- **prior state and reversal:** task state, assignment, destination, urgency and star can all be reversed; Done undo restores the state immediately preceding Done.
- **concurrency and retries:** ordinary Row stamps guard shared task edits; one user’s focus save must not overwrite another user’s settings.
- **external dependencies:** none.
- **durability and recovery:** shared work is stored as native Tables; personal focus is stored in server-side user settings and survives browser/device changes.
- **security and privacy:** tasks are team-visible; stars and personal order are returned only to their owning user.
- **accessibility:** rapid entry, completion, state, urgency, star and ordering work by keyboard with visible labels, not colour alone.
- **performance and scale:** initial lists may page at ordinary Featherbase limits; the first prototype targets one small team, not portfolio-scale planning.
- **observability:** Row history records shared task changes; comments preserve explanations; personal focus changes need no shared audit trail.
- **compound hazards:** TSK-H1 covers stale private ordering after tasks are deleted or become inaccessible.

## Rules

### TSK-R1 — A task starts from a title

> evidence: proven — title-only capture is exercised through the workspace and
> asserts the persisted neutral defaults.

A new task requires only a non-empty title. Its initial state is Not started, it is not urgent, and it has no responsible person.

### TSK-R2 — Inbox is a destination, not an owner

> evidence: proven — capture persists null destination and responsibility, and
> the new task renders in Inbox.

A task is in Inbox exactly while it has neither a team project nor a Personal tasks owner. Capturing it records the author but does not assign the author.

### TSK-R3 — Every task has at most one destination

> evidence: proven — server coverage rejects the impossible dual destination;
> component coverage moves Inbox work into Personal tasks.

| Project | Personal tasks owner | Result | Why? |
|---|---|---|---|
| empty | empty | Inbox | Captured, not triaged |
| set | empty | Team project | Shared project work |
| empty | set | Owner’s Personal tasks; owner is assigned | Personal destination carries responsibility |
| set | set | rejected | A task cannot live in two places |

**Property:** every valid task belongs to exactly one of Inbox, one project, or one user’s Personal tasks.

### TSK-R4 — Project creation and entry stay lightweight

> evidence: proven — component and browser walks create a name-only project and
> rapidly add an unassigned task.

A project requires only a name. Rapid entry inside it creates one unassigned task per submitted title without opening a full form.

### TSK-R5 — Responsibility and work state are independent

> evidence: proven — assigning an asymmetric case leaves it Not started.

A task has zero or one responsible person. Any team member may assign or reassign it. Assignment alone never changes the task’s work state.

### TSK-R6 — One state, with a completion shortcut

> evidence: proven — server transition cases cover checkbox undo from In
> progress and direct Done→Cancelled coherence.

Valid states are Not started, In progress, Blocked, On hold, Done and Cancelled. Ticking completion changes the state to Done; undo restores the state immediately preceding Done. Blocked, On hold and Cancelled remain deliberate state choices rather than checkbox outcomes.

### TSK-R7 — Current description and dated discussion stay distinct

> evidence: proven — component coverage skips one explanation, then saves a
> second explanation as a Comment.

The editable description states the current understanding. Comments append dated discussion. Choosing Blocked, On hold or Cancelled offers, but never requires, a comment.

### TSK-R8 — Urgent is shared and binary

> evidence: proven — the browser sets Urgent independently of private focus and
> renders the shared signal.

Every task is normal unless its shared Urgent flag is set. There are no Low, Medium or High priority levels.

### TSK-R9 — Star and focus order are private

> evidence: proven — focus is stored through caller-owned user settings while
> persisted task assignment remains unchanged.

Starring adds a task to the caller’s My Focus without changing its destination, assignment, state or urgency. Each user owns an independent ordered list.

### TSK-R10 — My Work shows each task once

> evidence: proven — component coverage focuses assigned and unassigned work and
> observes each task exactly once in My Work.

My Work renders My Focus first. Assigned to me then renders assigned tasks not already in My Focus. Unstarring an assigned task moves it to the second section; unstarring any other task removes it from My Work.

## Invariants and hazards

### TSK-I1 — Personal destination implies matching responsibility

> evidence: proven — Inbox triage to Personal tasks persists matching owner and
> responsible person while leaving state unchanged.

For every task with a Personal tasks owner, the responsible person equals that owner.

### TSK-I2 — A task never has multiple responsible people

> evidence: gap #296 — server coverage pending.

Assignment is one nullable user reference, not a collection of assignment rows.

### TSK-I3 — Personal focus never mutates shared task data

> evidence: proven — the focus walk verifies only user settings change; the two
> shared task rows retain their prior assignments.

Starring, unstarring and reordering change only the caller’s user settings.

### TSK-H1 — Focus references can become stale

> evidence: proven — a seeded missing task is omitted and removed on the next
> focus write while both readable tasks remain ordered.

If a focused task is deleted or no longer readable, My Focus omits it and removes the stale reference on the next focus write rather than failing the whole page.

## Deliberately deferred

- Bulk Inbox editing; the one-at-a-time triage journey is primary.
- Due dates, reminders, overdue rules and recurring tasks.
- Dependencies, subtasks, time tracking, capacity planning and private tasks.
- The ordering of the Inbox triage queue; real usage will decide it.
