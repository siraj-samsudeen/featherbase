# AGENTS.md

- For OpenSpec propose/apply/verify/archive workflows, use the `change-modes` skill: one worktree,
  branch and PR per change, from proposal to archive. It overrides the two-PR flow of the
  upstream `openspec-git-discipline` skill.
- Work starts from a GitHub issue and goes one issue at a time per worker; the manager session
  stays on `main`. See the `issue-workflow` skill (issue body, red/yellow/green rating, blocked by,
  task sessions and worktrees, the UI route).

## Review guidelines

These apply to every review of a change: local reviews before a PR, and PR reviews (Codex's
GitHub reviewer reads this section).

**Stance.** The product evolves fast. Getting the functionality to fit the need matters more than
perfect code. Do not add code, or follow-up issues, for things unlikely to happen.

**Who reviews locally.** Codex, if it is available (`codex review --base main`); otherwise a
review by a different Claude model than the one that wrote the code.

**UI changes take the UI route** (the `issue-workflow` skill): mockups, a numbered checklist in
the issue, then an independent verifier against the real UI, before the owner sees code. A code
review covers only what a person can't see when testing: security, permissions, data, server
logic. No review for docs, cosmetic changes or very minor fixes.

**Adversarial review only with the human's consent.** When the agent judges the work complex or
critical — security, permissions, data — it proposes an adversarial review (or the
`adversarial-authoring` skill for a planning artifact) in one line, with the reason, and runs it
only if the human says yes. It is never mandatory.

**At most 3 review rounds.** After the third, stop and propose the next step to the human instead
of starting a fourth.

**Triage every finding before presenting it:**

1. **Breaks core functionality** — wrong results, data loss, a security hole → fix now.
2. **Plausible in real use, limited impact** → fix it if cheap; otherwise file **one** issue for
   all such findings, not one per finding.
3. **Rare or theoretical edge case** → one line in the PR body under "Deliberately not handled".
   No code, no issue.

Present the findings grouped by these three levels. In a PR review, report level 3 findings as
level 3, not as requests for changes.

## Project

Featherbase is a metadata-driven low-code app platform on a JS/TS stack. It
began as a faithful replication of [Frappe Framework](https://frappe.io/framework)
and now diverges from Frappe wherever Frappe doesn't serve this platform's own
users. This section is featherbase's own standing rules; the shared process
above comes from the template through Copier.

### Project stage

Pre-release: every interface is provisional and nothing outside this repo
depends on a name, route, schema or wire format. When one is wrong, **change it
outright**. Add no redirects, aliases, shims or compatibility flags. Migrations
that converge a developer's local database are still expected. A migration that
rewrites a live instance's data is rehearsed on a restored snapshot first
(`docs/DEPLOY.md`). Revisit this section after the first real deployment.

### Where things live

| What | Where |
|---|---|
| Setup, commands, source map | `README.md` (one instance: `pnpm dev jeyarama/dash`; boot and smoke-test: `./init.sh`) |
| Behaviour: what the system promises | `openspec/specs/`, the sole authority |
| Decisions and why | `adr/`. An accepted ADR is never edited; a changed decision is a new ADR that supersedes it ([ADR 0015](adr/0015-adrs-are-never-edited.md)) |
| Words and the words they retire | `CONTEXT.md` |
| How tests are built and run | `docs/TESTING.md` |
| Deploying and environment variables | `docs/DEPLOY.md`, `docs/PREVIEW.md` |
| Issues, ratings and labels | the `issue-workflow` skill; `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md` |
| Apps shipped with the platform (Tasker); packages the tests install | `example-apps/`; `test-apps/` (never imported by platform source: `pnpm check:platform-imports`) |
| Apps built for one client (`jeyarama/dash` is Feather Dash) | `client-apps/<client>/<app>/`, run with `pnpm dev <client>/<instance>`; the client's conventions in `client-apps/<client>/CLAUDE.md` |

Don't add a document when a spec, test, ADR or PR body can carry it. A claim
about the code that no check can verify drifts; don't write it down as fact.

### Architecture invariants

1. **Everything derives from Table metadata.** Never hand-write a per-model
   table, endpoint or form.
2. **All reads and writes go through the server**, and every mutation runs the
   full trigger chain in one transaction.
3. **The Admin UI is generic**: one list view and one form view render every
   Table.
4. **No Frappe wire shapes.** They were removed on purpose.
5. **Platform, apps and instances are separate layers.** Where each lives is
   [ADR 0014](adr/0014-one-repo-for-platform-and-apps.md). Checks enforce
   the boundaries.

### How a piece of work goes

1. **Orient.** Read the issue and its OpenSpec change, `git log --oneline -20`
   and the relevant specs. Don't re-derive what an ADR already decided.
2. **Boot.** Run `./init.sh`. If the app is broken, fixing it is the task.
3. **One piece of work per session**, done fully: small, complete and working.
   Work goes one issue at a time per worker. The manager session stays on
   `main`; each issue is built in its own worktree, on branch
   `issue-<n>-<change-name>` (the `change-modes` skill). Give the worktree its
   own `.env` from `.env.example`, with its own `DATABASE_URL`, `API_PORT` and
   `WEB_PORT`, so it runs beside the main checkout and other worktrees.
4. **Verify the way a user would**: HTTP against the running server, and the
   browser for UI. Unit tests alone don't count.
5. **Record and hand off** in the PR body: what was done, the commands that
   verify it, and how the owner can try it.

Behaviour changes go through OpenSpec; every change starts from an issue. Run
OpenSpec as `pnpm exec openspec`. `pnpm check:specs` reports a finished change
that hasn't been archived yet.

### Hard rules

- **Nothing is done on an agent's word.** It is done when a command someone
  else can run says so. This includes work handed back by another agent:
  rerun its verification yourself.
- Never end a session with the app failing to boot. Keep `./init.sh` working,
  and change it in the same commit as the setup it reflects.
- **No expectation laundering.** Never weaken an expected outcome just to get
  a pass. A known defect is pinned with `it.fails` and its issue number.
- **A discovered behaviour is not a requirement.** Ratifying it, filing it as a
  defect or raising it as a question is the owner's call.
- **Small problems are fixed at once**, inline or by a subagent. Nothing goes on
  a "later" list.
- Fix `feather-testing-postgres` in its own repo and release it; never vendor
  it here.
- **Browser checks run headless**, including e2e and verifier runs. No visible
  windows on someone's machine.
- **Desktop first.** UI is built and checked for desktop. Phone work happens
  only when the owner asks for it in that piece of work.
- **Merge PRs with a merge commit** (`gh pr merge --merge`). Squash and rebase are
  off, so keep each commit meaningful: a test, then its fix.

### Code review here

Code review uses the `feather-code-review` skill, on top of the review
guidelines above.
