---
name: outside-in-tdd
description: The human-controlled build loop for an OpenSpec change — one planning artifact per commit, then one stop per test (the human's prediction) with red, green and refactor as separate commits that record the human's prediction and the real output. Use for every change: planning artifacts, code, tests, dependencies and config.
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

The human controls every step that has something to decide. The agent drafts, runs and
commits, and keeps going between those steps; the human can interrupt at any time.

## When to stop

Stop only when the stop has content the human can change:

- **A draft to review** — a planning artifact. The review is the approval; approval commits it.
- **A real decision** — a domain or design fork only the human can settle. Always bring a
  recommendation.
- **A prediction** — before every red run.
- **A refactor with a named smell.**

Never stop just to ask permission to continue ("say go when you want me to draft X", "shall I
commit?", "shall I write the code?", "refactor? none"). Formatting and tooling choices are never
asked: use the defaults in `CLAUDE.md`.

## Planning — one artifact per commit

Follow the schema's artifact order: proposal → specs → design → adr → tasks. For each one the
agent drafts it (using the skills `openspec/config.yaml` names for it) — taking its own position on
every open question, with a recommendation — the human reviews and edits, and it is committed.
Then the agent drafts the next one without asking.

```
<artifact>: <change-name> — <one line on what it settles>
```

`tasks.md` is the test list (see the schema). `design.md` is a hypothesis: when the build leads
somewhere else, a later `design:` commit records what changed and why.

## Building — one stop per test

Take the next unticked task in order. Follow the `test-driven-development` skill for the shape
of each test; this skill adds the stops and the record.

1. **Show the test** and why it is next, **and ask for the prediction in the same message** —
   answering it also approves the test (or the human edits the test instead).
2. **Predict.** The human says what will happen when it runs. "Don't know" is a valid answer;
   silence is not. The agent predicts only when the human says "don't know" or asks — then with
   a one-line reason.
3. **Run it.** Paste the real failure lines, never a summary. If it fails for the wrong reason
   (a missing module, a typo), fix the test or add the smallest stub and run again.
4. **Commit `red:`** — the test plus the smallest stub only.
5. **Write the minimal code** and run the suite — no stop; show the diff with the result.
6. **Commit `green:`** — code only, no test changes. For the outer test or a change to shared
   code, ask the human to predict the suite result first.
7. **Refactor** only when there is a smell: name it and let the human decide. No smell, no stop. A refactor is its own
   `refactor:` commit: structure only, no assertion changes, same pass count.
8. Tick the task. Add any newly discovered inner test to `tasks.md` as `(added)`. Move to the
   next task.

Tests the task list already expects to pass on their first run are run together, one `test:`
commit each, and reported in one message.

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
test: <behaviour>

Predict: passes — <why the behaviour already exists>
Actual: <N pass, 0 fail> ✓ — <the mutant it kills, or what would make it fail>
```
A `test:` commit is for a test that passes on its first run — a ratified behaviour, or one an
earlier green already delivered. With no red, its proof is what it guards: name the surviving
mutant it kills, or the change that would make it fail.
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
- knip needs `"entry": ["**/*.test.ts"]` when tests are the only entry points (otherwise it
  reports every file as unused), and `ignoreDependencies` for the Stryker packages (it cannot
  see `appendPlugins`).
- Stryker: use `@hughescr/stryker-bun-runner`, listed in `appendPlugins` with every other
  plugin (Bun workspaces hide plugins behind symlinks). `bun init` installs TypeScript 7, which
  Stryker cannot use: skip the TypeScript checker, and set `tsconfigFile` to a file that does
  not exist so Stryker does not rewrite `tsconfig.json` (only needed when it `extends` a
  relative path). Add `ignorePatterns: [".claude", ".agents", ".opencode", "openspec"]` — the
  symlinked skills break its sandbox copy.
- Give each test its own database (`:memory:` or a temp file). A shared file under parallel
  Stryker workers produces false kills.
