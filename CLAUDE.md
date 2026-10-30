# Featherbase — Agent Instructions

Featherbase is a metadata-driven low-code app platform on a JS/TS stack. It
began as a faithful replication of [Frappe Framework](https://frappe.io/framework)
and now diverges from Frappe wherever Frappe doesn't serve this platform's own
users. This file is the standing process; the detail lives in the places it
points to.

## Project stage

Pre-release: every interface is provisional and nothing outside this repo
depends on a name, route, schema or wire format. When one is wrong, **change it
outright**. Add no redirects, aliases, shims or compatibility flags. Migrations
that converge a developer's local database are still expected. A migration that
rewrites a live instance's data is rehearsed on a restored snapshot first
(`docs/DEPLOY.md`). Revisit this section after the first real deployment.

## Where things live

| What | Where |
|---|---|
| Setup, commands, source map | `README.md` (boot everything with `./init.sh`) |
| Behaviour: what the system promises | `openspec/specs/`, the sole authority |
| Decisions and why | `docs/adr/`. Correct or delete an ADR when it stops matching the code |
| Words and the words they retire | `CONTEXT.md` |
| How tests are built and run | `docs/TESTING.md` |
| Deploying and environment variables | `docs/DEPLOY.md`, `docs/PREVIEW.md` |
| Issues and triage labels | `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md` |
| Apps built for one client (`jeyarama/dash` is Feather Dash) | `client-apps/<client>/<app>/`, opt-in at boot with `FEATHERBASE_CLIENT_APPS`; the client's conventions in `client-apps/<client>/CLAUDE.md` |

Don't add a document when a spec, test, ADR or PR body can carry it. A claim
about the code that no check can verify drifts; don't write it down as fact.

## Architecture invariants

1. **Everything derives from Table metadata.** Never hand-write a per-model
   table, endpoint or form.
2. **All reads and writes go through the server**, and every mutation runs the
   full trigger chain in one transaction.
3. **The Admin UI is generic**: one list view and one form view render every
   Table.
4. **No Frappe wire shapes.** They were removed on purpose.
5. **Platform, apps and instances are separate layers.** Where each lives is
   [ADR 0014](docs/adr/0014-one-repo-for-platform-and-apps.md). Checks enforce
   the boundaries.

## How a piece of work goes

1. **Orient.** Read the issue and its OpenSpec change, `git log --oneline -20`
   and the relevant specs. Don't re-derive what an ADR already decided.
2. **Boot.** Run `./init.sh`. If the app is broken, fixing it is the task.
3. **One piece of work per session**, done fully: small, complete and working.
4. **Verify the way a user would**: HTTP against the running server, and the
   browser for UI. Unit tests alone don't count.
5. **Record and hand off** in the PR body: what was done, the commands that
   verify it, and how the owner can try it.

Behaviour changes go through OpenSpec. `openspec/config.yaml` and its skills
carry the workflow. Every change starts from an issue.

## Hard rules

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

## Review guidelines

- **UI changes:** agree the design as a numbered checklist in the issue. Then a
  separate verifier agent runs the real UI at 1280px and 375px and returns a
  "spec vs built" table with screenshots, before the owner sees code.
- **Code review** uses the `feather-code-review` skill. Run a Codex review if
  Codex is available, otherwise a review by a different Claude model. Review
  only what a person can't see when testing: security, permissions, data,
  server logic. No review for docs, cosmetic changes or very minor fixes.
- **Adversarial review only with the owner's consent.** Propose it for complex
  work or anything touching security, permissions or data.
- **At most 3 rounds**, then propose the next step to the owner.
- **Triage findings before presenting them:**
  1. breaks core functionality: fix now;
  2. plausible, limited impact: fix if cheap, otherwise **one** issue;
  3. rare or theoretical: one line under "deliberately not handled" in the PR
     body, with no code and no issue.
- **The product is evolving fast.** Fitting the need beats perfect code.
