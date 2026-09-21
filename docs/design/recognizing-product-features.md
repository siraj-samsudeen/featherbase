# Recognizing product features

Use this guide when deciding where one product feature ends and another begins.
It is a living design aid: revise it when a real specification exposes a useful
dimension or shows that one of these tests gives the wrong boundary.

## Start with the data model, but do not stop there

Create, read, update and delete (CRUD) operations are a useful first signal. They
show which records and rules a behavior touches. They do not, by themselves,
identify a product feature.

The same operation can serve different user goals. Quick Task Capture and adding
a task inside a project both create a Task, but the first deliberately postpones
placement while the second starts with a known project. Conversely, one feature
can span several operations: processing Inbox items reads an unplaced task,
updates its destination and responsibility, and then reads the next item.

## Dimensions to examine

For each possible feature, answer all of these:

1. **Data operations — what records change?**
   List the records created, read, updated or deleted and the rules protecting
   them. Treat this as evidence, not the verdict.
2. **User goal — what is the person trying to finish?**
   State it in the person's language. If the group needs two unrelated goals
   joined by “and,” it probably contains two features.
3. **Starting context — what does the person already know?**
   The same data operation can be a different feature when one path starts with
   a known project and another starts with an unresolved thought.
4. **Required decision — what choice does the person make?**
   Capture avoids a placement decision; Inbox processing exists to make it.
   Different decisions often mark different features.
5. **Completion point — when is this goal finished?**
   Name the observable handoff. Quick Capture finishes when a neutral task is in
   Inbox and the entry is ready again. Inbox processing finishes when the item
   has a destination or is deliberately left unresolved.
6. **Defaults and rules — which outcomes must always be true?**
   Behaviors that share defaults, allowed states and invalid combinations often
   belong together because changing one requires reviewing the others.
7. **Can it change independently?**
   A useful feature can evolve without forcing an unrelated product decision.
   Moving a control to another screen should not redefine the behavior.
8. **Can it be proved independently?**
   Its scenarios should make sense and produce meaningful evidence without an
   unrelated journey being run first.

## Tests for a proposed boundary

A strong feature boundary usually passes these tests:

- **One-sentence test:** “A person can …” describes one recognizable outcome.
- **Shared-rules test:** its scenarios depend on the same small set of rules.
- **Handoff test:** its start and completion point are explicit.
- **Change-together test:** a product change would naturally make us review the
  requirements in this feature together.
- **Useful-alone test:** delivering or discussing it alone still has product
  value.

Do not use these as feature boundaries by default:

- **The whole product:** too many goals and rules collect under one heading.
- **One screen:** navigation changes more often than product behavior.
- **One journey:** a journey may cross several features to complete a larger job.
- **One CRUD operation:** similar storage mechanics may serve different goals.
- **One implementation module:** code ownership and user capability are related,
  but neither reliably defines the other.

## Worked Tasker example

| Behavior | Data operation | User goal | Starting context | Completion point | Feature |
|---|---|---|---|---|---|
| Quick Capture | Create Task | Record something before forgetting it | Destination and owner are unknown | Neutral task appears in Inbox; entry is ready again | Quick Task Capture |
| Process Inbox item | Read and update Task | Decide where captured work belongs | An unplaced task already exists | Task is placed, or deliberately left unresolved | Processing Inbox Items |
| Create a project and enter its tasks | Create Project and Tasks | Turn a body of work into an actionable project | The project does not exist | Named project exists with its task list ready | Start a Project |

Quick Capture and project task entry both create Tasks, but their goals,
starting contexts, defaults and completion points differ. Project creation and
project task entry touch different record types, but belong together because an
empty Project record is not yet the useful user outcome. The useful-alone test
overrides the CRUD boundary: **mechanically complete data is not necessarily a
complete product capability**.

## How this guide evolves

When a real specification feels wrongly split or wrongly combined:

1. name the concrete behavior that does not fit;
2. identify which dimension exposed the mismatch;
3. adjust the feature boundary first; and
4. update this guide only when the lesson will help recognize future features.

Examples teach the method better than abstract rules. Keep at least one current
worked example here when the guide changes.
