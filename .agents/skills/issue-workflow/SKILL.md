---
name: issue-workflow
description: How work moves from a GitHub issue to a merged PR - the issue body and its red/yellow/green rating, "blocked by" links, one issue at a time per worker, the manager session on main and the task session or subagent that does the work in its own worktree, and the UI route (mockups, a numbered checklist in the issue, an independent verifier). Use when filing, rating, linking or picking up an issue, when starting or briefing a task session or subagent, when a piece of work changes UI, or when creating the repo's labels.
---

# Issue workflow

The project's values come from `.copier-answers.yml` at the repo root: `repo`, `extra_labels`,
`desktop_first`, `ui_verifier_width`, `screenshots_in_prs`. Read them there; never hard-code
them into this skill.

## Every piece of work starts from an issue

Issues live in the GitHub repo `repo` names. Use `gh` for every operation (`gh issue create`,
`gh issue view <n> --comments`, `gh issue edit <n> --add-label ...`).

**The issue body**, in this order. Leave out a section that has nothing to say:

```markdown
Rating: **red** (blocker). Part of #<n>. Blocked by #<n>. Blocks #<n>. Related: #<n> (<why>).

## What happened            <!-- a bug: what the person did and saw; a feature: what they need -->
## Cause                    <!-- a bug: the code reasons, numbered, with file paths -->
## How to reproduce         <!-- numbered steps anyone can follow -->
## Agreed design (owner, <dd-Mon-yyyy>)
1. <one checkable point per line, numbered: the checklist the build and the verifier follow>

Not in this issue: <what was split off, with its issue number>.

Review route: <UI, so an independent verifier at <width> against this checklist | code review>.
```

The first line carries the rating and the links, so a reader sees at once how urgent the issue
is and what it waits on.

## Ratings — every issue gets one

| Label | Meaning |
|---|---|
| `red` | Blocker: has to be fixed |
| `yellow` | Workable, but easy to get wrong |
| `green` | Nice to have: blocks nothing major |
| `chore` | Maintenance with no behaviour change: dependencies, tooling, housekeeping |

An issue holding several items carries one overall rating, and may rate each item in its body.
`scripts/create-labels.sh` creates these labels, plus the project's `extra_labels`, in `repo`
(rerun it after changing the answers; it updates labels that already exist).

## Blocked by — GitHub's own issue dependencies

Record "blocked by" as a native GitHub dependency, not only as text, so GitHub shows it and
reports it:

```bash
blocker_id=$(gh api repos/<repo>/issues/<blocker> --jq .id)    # the database id, not the number
gh api --method POST repos/<repo>/issues/<blocked>/dependencies/blocked_by -F issue_id="$blocker_id"
```

`gh api repos/<repo>/issues/<n> --jq .issue_dependencies_summary.blocked_by` counts the open
blockers; an issue is ready when it is 0. Also name the blocker in the first line of the body.

## One issue at a time

A worker takes one issue, builds it fully, tests it, and its PR is merged before that worker
starts the next. Small problems found on the way are fixed at once, or filed as an issue with a
rating; nothing goes on a "later" list.

## Manager and workers

The session where an issue starts is the **manager session**. It stays on `main` in the main
checkout and takes the design decisions with the owner: one question per message, a mockup for
every UI option, until the agreed design is a numbered checklist in the issue. Then one worker
does the work:

- **A task session** (a session the owner can open): give the owner its link and stop. The owner
  works with it directly. The manager does not relay its reports, questions or documents, does
  not review its drafts unasked, and does not tell it to report to the manager.
- **A subagent**: it reports back to the manager, which checks the result itself (reruns its
  verification; nothing is done on an agent's word).

A task session's brief says: ask the owner directly, one question per message, mockups for UI;
commit each step on the owner's approval; work in the issue's worktree.

### Each task session gets its own worktree

```bash
git worktree add ../<repo-name>-issue-<n> -b issue-<n>-<change-name> main
```

The worktree has its own ports and its own database, so it runs beside the main checkout and
other worktrees without clashing; how to set them is a project fact (`CLAUDE.md` § Project).
One branch and one PR per change, from proposal to archive (the `change-modes` skill). Remove
the worktree after the owner merges.

## UI route

A change a person can see goes this way instead of a code review:

1. **Mockups.** Every UI option is shown as a visual (a mockup of each option, side by side,
   with the real screen and real data), with a short description, pros and cons and one
   recommendation. Never text alone.
2. **Checklist.** The agreed design goes into the issue as a numbered checklist (§ The issue
   body).
3. **Build** it.
4. **Verifier.** A separate verifier subagent, given the checklist and the running app but not
   the builder's view, drives the real UI in a headless browser at `ui_verifier_width` pixels
   and returns a "spec vs built" table: each checklist point, what it saw, pass or fail, with a
   screenshot. With `desktop_first: true`, UI is built and verified at that desktop width only;
   phone widths are added only when the piece of work asks for them.
5. **Fix the differences** before the owner sees the screenshots, the code or a PR.

Put the verifier's screenshots in the PR body only when `screenshots_in_prs` is true; otherwise
the table alone. A change that mixes UI with hidden logic takes both routes.

Browser checks run headless, verifier runs included: no visible windows on someone's machine.
