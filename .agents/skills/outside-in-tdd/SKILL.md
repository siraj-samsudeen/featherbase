---
name: outside-in-tdd
description: The human-controlled build loop for an OpenSpec change — one planning artifact per commit, then one test per "go" with red, green and refactor as separate commits that record the human's prediction and the real output. Use for every change: planning artifacts, code, tests, dependencies and config.
---

# Outside-in TDD with the human in control

## Why

The commits must show how the code was actually written, so a reviewer — or someone learning
from it — can follow the same process step by step. Three rules follow from that:

- **Every change is mandated by a test.** No code, dependency or file arrives without a failing
  test that needs it. Config no test can drive needs a stated reason (`Breaks without it:`).
- **Red and green are separate commits**, so each step can be checked out and replayed.
- **What the code cannot show goes in the commit message** — the command run, the prediction,
  the actual output, what was deliberately not built.

The human approves every step. The agent drafts, runs and commits; it never moves to the next
step on its own.

## Planning — one artifact per commit

Follow the schema's artifact order: proposal → specs → design → adr → tasks. For each one the
agent drafts it (using the skills `openspec/config.yaml` names for it), the human reviews and
edits, and only then is it committed:

```
<artifact>: <change-name> — <one line on what it settles>
```

`tasks.md` is the test list (see the schema). `design.md` is a hypothesis: when the build leads
somewhere else, a later `design:` commit records what changed and why.

## Building — one test per "go"

Take the next unticked task only when the human says "go" (or names a task). Follow the
`test-driven-development` skill for the shape of each test; this skill adds the gates and the
record.

1. **Show the test** and why it is next. The human approves or edits it.
2. **Predict.** Ask the human what will happen when it runs. "Don't know" is a valid answer;
   silence is not. The agent predicts only when the human says "don't know" or asks — then with
   a one-line reason.
3. **Run it.** Paste the real failure lines, never a summary. If it fails for the wrong reason
   (a missing module, a typo), fix the test or add the smallest stub and run again.
4. **Commit `red:`** — the test plus the smallest stub only.
5. **Show the minimal code.** The human approves. Run the suite.
6. **Commit `green:`** — code only, no test changes. For the outer test or a change to shared
   code, ask the human to predict the suite result first.
7. **Refactor?** Name the smell or say "none". The human decides. A refactor is its own
   `refactor:` commit: structure only, no assertion changes, same pass count.
8. Tick the task. Add any newly discovered inner test to `tasks.md` as `(added)`. Wait for "go".

The outer test of a scenario stays `test.todo` while its inner tests run; it is promoted in its
own green step. `bun test --todo` fails with "Remove `.todo`" once it passes — that is the cue.

**Step size.** If the human's predictions keep matching, the steps are too small — take bigger
ones. If they keep missing, slow down.

## Commit formats

```
red: <behaviour in plain words>

Predict: <the human's prediction>
Actual: <the real assertion lines> ✓
```
```
red: <behaviour>

Predict: don't know · agent: <prediction> — <one-line reason>
Actual: <the real assertion lines> ✓
Learned: <one line>
```
```
red: <behaviour>

Predict: <the human's prediction>
Actual: <the real assertion lines> ✗ — <why it differed>
```
```
green: <same subject as its red>

Green: <command> → <N pass, 0 fail>
Not built: <what was deliberately left out, and why>
```
```
refactor: <the smell, named>

Green: same N pass
```
```
config: <what>

Why: <the current need>
Breaks without it: <what fails if this is removed>
```
```
chore: <what>

Ran: <exact generator or install commands>
```

## Rules

- A dependency arrives in the red/green pair whose test needs it.
- Generator output is committed raw, with the exact command, then trimmed in its own commit.
- Merge with merge commits. Never squash — it erases the steps.
- These formats are enforced by review, not a hook. Revisit after 100–200 commits, when we know
  which fields hold up.
- **Diverges from Kent Beck on purpose:** Beck commits only when all tests pass. We commit the
  red, because the prediction and the observed failure are the record we want.

## Stop when you see (Kent Beck's warning signs)

- Loops — the same fix attempted again and again.
- Functionality nobody asked for, even a reasonable next step.
- Tests disabled, deleted or weakened to get green.

## Reconcile — end of every change

Run the checks the `## Reconcile` group in `tasks.md` lists. Every finding gets one of three
fates — **ratify** (a `specs:` commit adds the scenario, then a test pins it), **delete**
(`refactor:`), or **ask** (the human decides):

- `bun test --coverage` — 100% of lines and functions.
- `knip` — unused files, exports and dependencies.
- `bunx tsc --noEmit` — types.
- Stryker — every surviving mutant is a missing test or code nobody needs.

Then `openspec verify`, and archive.

## Tooling gotchas (Bun 1.4.2, verified 21-Oct-2026)

- A `coverageThreshold` failure exits 1 **with no message**, under "0 fail".
- knip needs `"entry": ["**/*.test.ts"]` when tests are the only entry points; otherwise it
  reports every file as unused.
- Stryker: use `@hughescr/stryker-bun-runner`, listed in `appendPlugins` with every other
  plugin (Bun workspaces hide plugins behind symlinks). Run **without** the TypeScript checker
  — Stryker cannot run on TypeScript 7, and TypeScript 5 cannot type drizzle-typebox.
- Give each test its own database (`:memory:` or a temp file). A shared file under parallel
  Stryker workers produces false kills.
