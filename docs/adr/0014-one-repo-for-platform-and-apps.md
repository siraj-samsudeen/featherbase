# ADR 0014: One repository for the platform and its apps; a private repository per client for its instances

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
- secrets and instance details kept private.

Client app code being public is acceptable to the first client and will be the
stated terms for future ones.

## Decision

### 1. This repository holds the platform and every app

```
apps/ (server, web)           the platform
example-apps/                 apps shipped with the platform (Tasker, Tickets)
client-apps/<client>/<app>/   one folder per client, one per app inside:
                              jeyarama/dash, later jeyarama/answers
```

- A platform change and the app change that needs it are **one PR**, tested
  together in CI.
- The platform never imports from `example-apps/` or `client-apps/`. A lint rule
  enforces this, because one repository no longer enforces ADR 0011's one-way
  rule physically.
- Client app code may be public. Client **data, secrets and instance details
  never are**. The `check:sensitive` guard covers the client folders too.
- Each client folder has one `CLAUDE.md` for that client's conventions, such
  as number and date formats, shared by all of its apps.
- A client app arrives as a **snapshot of its current files, without its git
  history**. The history stays in the client's repository, and the import
  commit names the source commit. Go-live is a fresh install, so no instance
  upgrades from an earlier version. The first client app enters as
  `jeyarama/dash` **0.1.0**, with no upgrade history.
- This repository keeps its own history.

### 2. Each client has a small private instance repository

It holds what differs between deployments, and no code:

- each instance's settings file (`dev/`, `prod/`, and more if the client has
  more instances);
- the privacy notice, host and service names, mail setup, and one-off setup
  steps;
- **the released image each instance runs.**

Merging a one-line change to that release line **is the deploy decision**, and
its history is the deploy log. Whoever may merge in that repository approves a
production release: the owner's team today, the client's own people later.

One repository per client, not per instance: a new instance is a new folder
there plus a new host project.

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

### 4. Releases build images; ordinary commits do not

- Day-to-day work runs from source.
- **A client app's image is built when the app is released**, for example on a
  tag such as `jeyarama/dash@1.2.0`, not on every commit.
- **An app's version changes only in a release PR.** Feature PRs leave it
  alone. An instance records each installed app's version with a fingerprint
  of its files, so changed code under an unchanged version would make the app
  unavailable there. Dev and prod therefore follow app releases, not `main`.
- A CI check fails a release PR whose app version is not greater than `main`'s.

### 5. CI stays lean

Many agents open many small PRs, so the required checks are only the fast ones
for the area a PR touches (path-filtered). Heavy suites run on demand (the
`run-e2e` label), on `main`, or at release. The follow-up that implements this
sets the target time and lists what leaves the required set.

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
    client **apps** live here, while client data, secrets and instance details
    stay in the client's private instance repository.
  - The delivery question it left open is answered by section 4.
  - The product app / client app distinction stands.
- **ADR 0011:** the one-way rule stands. It is now enforced by a lint rule
  instead of a repository boundary.
- **ADR 0010:**
  - The stock `core` profile gives way to the intent-driven template.
  - "Archive in the PR that finishes the change" gives way to the proposal PR
    first and archiving on `main` after the implementation merges.
  - OpenSpec stays the behaviour contract.
- **`CLAUDE.md` invariant 5** ("client-specific material lives only in that
  client's private repository") is rewritten to match when the move lands.
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
| Put instances in this repository too (`instances/<client>/`) | Host names, mail setup and privacy wording would be public, and a client's operators would need write access here. Splitting a folder out of a public repository later leaves its history public forever |
| A private copy for every client, the first one included | Each platform feature born from a client app would need a private PR and then a cherry-pick PR here, plus weekly syncs |
| Restart this repository with clean history: a new repository and the old one made private, or a rewrite in place | Considered on 30-Oct-2026. The owner chose to keep the history. Outdated material is pruned from the files instead (see below) |

## Consequences

- One checkout and one PR for platform and app work. Client app tests run in CI
  and every client app PR gets the Codex bot's review.
- The release pin does not disappear; it changes meaning. It used to mean
  "which platform this app compiles against". Now it means "which release this
  instance runs", and it lives where that decision belongs.
- Two models exist side by side: apps upstream for clients the owner's team
  builds, and private copies for clients with their own developers.
- The move happens before go-live, which is a fresh reinstall of dev and prod,
  so the client-specific jobs and seed packs leaving the platform move once, in
  this layout.
- **Deferred:** capturing agent sessions alongside commits (for example with
  Entire). It will be trialled after go-live, one change at a time.
