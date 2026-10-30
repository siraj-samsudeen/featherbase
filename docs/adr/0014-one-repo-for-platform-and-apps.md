# ADR 0014: One repository for the platform, its apps and their instances

**Status:** Accepted · **Date:** 2026-10-30 · **Amends:** [ADR 0010](0010-openspec-change-workflow.md), [ADR 0011](0011-platform-app-instance.md), [ADR 0013](0013-client-apps-and-product-apps.md) · **Issue:** [#703](https://github.com/siraj-samsudeen/featherbase/issues/703) · **Client side:** JeyaramaGroup/data-warehouse#4532

## Context

ADR 0013 put a client app in the client's own private repository. The app
reached a server in a client image built `FROM` this repository's platform
image, pinned by commit SHA on one line of the client's Dockerfile.

That split put a repository boundary through the seam that moves most. Most
platform features so far were born from the first client app: dataset guards
(#669, #676), app-declared scheduled jobs (#701) and the scope provider. Each
one needed:

- a PR here and a PR in the client's repository, landed in order;
- a pin bump once this repository published the image;
- two reviews, by people and agents who each saw only half the change.

The client app's platform tests ran only by hand inside a local checkout of
this repository, never in CI. Over 27–28 Oct 2026 the client repository merged
eight app-version PRs, several of them waiting on a PR here, and two parallel
PRs both claimed the same app version.

The owner's goals, from the 30-Oct-2026 design interview:

- one checkout for maintainers and for agents;
- an obvious line between what is platform and what is app;
- example apps and client apps side by side, so newcomers see how different
  kinds of app are built on the same platform;
- secrets kept private.

Client app code being public is acceptable to the first client and will be the
stated terms for future ones.

## Decision

### 1. This repository holds the platform and every app

```
apps/ (server, web)           the platform
example-apps/                 apps shipped with the platform (Tasker, Tickets)
client-apps/<client>/<app>/   one folder per client, one per app inside:
                              jeyarama/dash, later jeyarama/answers
client-apps/<client>/instances/<instance>/
                              one folder per deployment of that client's apps:
                              jeyarama/instances/dash
```

- A platform change and the app change that needs it are **one PR**, tested
  together in CI.
- The platform never imports from `example-apps/` or `client-apps/` (nor from
  `test-apps/`, the packages the tests install). A check,
  `pnpm check:platform-imports`, enforces this, because one repository no
  longer enforces ADR 0011's one-way rule physically.
- Client app code and instance settings may be public. Client **data and secrets
  never are**. The `check:sensitive` guard covers the client folders too.
- Each client folder has one `CLAUDE.md` for that client's conventions, such
  as number and date formats, shared by all of its apps.
- A client app arrives as a **snapshot of its current files, without its git
  history**. The history stays in the client's repository, and the import
  commit names the source commit. Go-live is a fresh install, so no instance
  upgrades from an earlier version. The first client app enters as
  `jeyarama/dash` **0.10.0**, keeping its version number but with no upgrade history (owner, 30-Oct-2026: the next change is 0.10.1).
- This repository keeps its own history.

### 2. Instances live in the repository too; where each kind of value goes

An instance is one deployment of a client's apps. A client may have several, each
running different apps. Its folder holds no code: `instance.json` (the apps it runs),
`instance-settings.json` (base values plus `local`, `dev` and `prod` sections), the
privacy notice and one-off setup steps.

Keeping these in a private repository, as first decided here, brought back two
folders and two PRs for any change touching code and a setting. The files hold no
secret, so the privacy it bought was small.

| Kind of value | Where it lives |
|---|---|
| **Secrets** | Environment variables on the host; a gitignored `.env.local` on a developer's machine |
| **Settings that aren't secret** | The instance's settings file, in git |
| **Private but not secret, per environment** (a Dive id) | A `{ "env": "NAME" }` reference in the settings file: the name is public and reviewed, the value is a host variable, read when settings are applied and kept out of exports and logs. It survives a wipe, because variables live outside the database |
| **Changed by people at runtime** | Left out of the file and edited in Admin. A field the file sets is locked there |
| **Business data** (people, the org chart, sales) | The instance's database, never git |

**Running one:** `pnpm dev <client>/<instance>` from a clone boots everything,
on Windows too, and `--made-up-data` makes a client app's report work with no real
data. Hosted, the variable `FEATHERBASE_INSTANCE=<client>/<instance>` picks it.

### 3. A client with its own developers works downstream, in a private copy

A GitHub fork of a public repository is always public, so such a client works
in a **private copy** of this repository:

- `upstream` points here and is fetch-only (`git remote set-url --push
  upstream DISABLED`), so private work cannot be pushed here by mistake.
- A scheduled workflow merges `upstream/main` into a "Sync from featherbase" PR
  every week, so their CI shows what upstream changed.
- Their apps live in `client-apps/<client>/` and their instances in
  `instances/`. Upstream never edits either, so a sync conflicts only where
  they changed platform files.
- **A platform change goes back as a small PR soon**, never as a long-lived
  difference. Cut a branch from `upstream/main`, cherry-pick only the platform
  commits, push it somewhere public, and open the PR here. A branch cut from
  upstream cannot carry their private history.

The sync workflow and the contribute script ship in this repository, so every
downstream copy gets them, and their improvements, through its first sync.

### 4. Dev follows `main`; prod follows a release branch

- The host builds an instance's image from this repository on each deploy. Its
  deploy step migrates, installs or upgrades the instance's apps, and applies its
  settings. Any failure fails the deploy, and the old one keeps serving.
- **Dev follows `main`.** An instance records each installed app's version with a
  fingerprint of its files, so on dev, when an app's files change under the same
  version and manifest, the deploy re-pins them automatically.
- **Prod follows `release/<client>-<instance>-prod`.** Merging `main` into it is the
  deploy decision, and its history is the deploy log. Production never re-pins: a
  code change there needs a new version.
- **An app's version changes when its manifest changes or when it goes to prod,**
  and a CI check fails a PR whose app version isn't greater than `main`'s.

Steps for a host are in "A client instance" in `docs/DEPLOY.md`.

### 5. CI stays lean

Many agents open many small PRs, so a PR runs only what its paths need: fast checks
alone for docs, a client app's own tests for a client app, and everything for shared
files or on `main`. `main` requires the `unit` and `e2e` verdicts, and merges are
merge commits only, so a PR's steps stay readable. `docs/TESTING.md` has the detail.

### 6. One way of working

- **Issues.** Every change starts from an issue. When an OpenSpec change exists,
  the issue stays thin and links to it.
- **Area labels**, applied automatically from file paths: `area:platform`,
  `app:<name>`, `client:<name>`.
- **Titles and messages.** PR and commit titles start with their scope
  (`platform: …`, `jeyarama/dash: …`). Messages carry the `[#N]` issue prefix.
- **OpenSpec.** OpenSpec runs with the intent-driven template's
  `proposal → specs → design → adr → tasks` chain, from the owner's fork
  `intent-driven-with-human-control`.
  - Each change picks a mode when it is created:
    - **autopilot**: subagents build, acceptance tests first;
    - **build**: one test at a time, the human predicting each failure;
    - **learning**: build, plus every command shown and explained first.
  - The proposal merges to `main` in its own PR before implementation. The
    change is archived on `main` after the implementation merges.
- **Review.**
  - Locally, a Codex review when Codex is available, otherwise a review by a
    different Claude model. The Codex bot also reviews every PR.
  - An adversarial review runs only with the owner's consent, proposed when a
    change is complex or touches security, permissions or data.
  - At most three review rounds; then the agent proposes the next step to the
    owner.
  - Before findings are presented, they are triaged:
    1. **breaks core functionality** (wrong results, data loss, a security
       hole): fix now;
    2. **plausible in real use, limited impact**: fix if cheap, otherwise
       **one** issue;
    3. **rare or theoretical**: one line under "deliberately not handled" in
       the PR body, with no code and no issue.
  - The stance: the product is evolving fast, and fitting the need matters
    more than perfect code.
  - This lives in `AGENTS.md` under "Review guidelines", the section every
    local agent and the Codex PR reviewer read.
- **No CODEOWNERS** while one team reviews everything. Add a line per folder
  when someone outside it must approve that folder.

## What this amends

> *30-Oct-2026 (#705): these amendments are now written into the text of
> ADRs 0010, 0011 and 0013, each with a dated correction note, so a reader no
> longer has to reconcile the chain. The list below is kept as the record of
> what changed.*

- **ADR 0013:**
  - *"Nothing from a client's repository enters this public one"* becomes:
    client **apps and instances** live here, while client data and secrets stay out.
  - The delivery question it left open is answered by section 4.
  - The product app / client app distinction stands.
- **ADR 0011:** the one-way rule stands. It is now enforced by a check
  (`pnpm check:platform-imports`) instead of a repository boundary.
- **ADR 0010:**
  - The stock `core` profile gives way to the intent-driven template.
  - "Archive in the PR that finishes the change" gives way to the proposal PR
    first and archiving on `main` after the implementation merges.
  - OpenSpec stays the behaviour contract.
- **`CLAUDE.md` invariant 5** is now a pointer to this ADR.
- **ADRs are no longer append-only.**
  - An ADR that stops matching the code is corrected in place with a dated
    note.
  - It is deleted once its content lives somewhere better; git keeps it.
  - `CLAUDE.md` is changed in this ADR's PR.
  - A one-off pass over the existing ADRs follows as its own issue
    ([#705](https://github.com/siraj-samsudeen/featherbase/issues/705)).

## Options considered

| Option | Why not |
|---|---|
| Keep two repositories, add a bot that opens paired PRs and bumps the pin | Treats the symptom: still two checkouts, two reviews and an ordering wait |
| Embed this repository in the client's as a git submodule | Same pin and two PRs, plus submodule friction in every agent worktree |
| A private repository per client for its instances | Tried first and dropped on 30-Oct-2026: two folders and two PRs again for any change touching code and a setting, to protect files that hold no secret. The cost here: handing prod to a client's own people needs access to this repository |
| A private copy for every client, the first one included | Each platform feature born from a client app would need a private PR and then a cherry-pick PR here, plus weekly syncs |
| Restart this repository with clean history: a new repository and the old one made private, or a rewrite in place | Considered on 30-Oct-2026. The owner chose to keep the history. Outdated material is pruned from the files instead (see below) |

## Consequences

- One checkout and one PR for platform and app work. Client app tests run in CI
  and every client app PR gets the Codex bot's review.
- The version pin goes away. "Which release prod runs" is now a branch, not a
  value to keep in step with something else.
- Two models exist side by side: apps upstream for clients the owner's team
  builds, and private copies for clients with their own developers.
- The move happens before go-live, which is a fresh reinstall of dev and prod,
  so the client-specific jobs and seed packs leaving the platform move once, in
  this layout.
- **Deferred:** capturing agent sessions alongside commits (for example with
  Entire). It will be trialled after go-live, one change at a time.
