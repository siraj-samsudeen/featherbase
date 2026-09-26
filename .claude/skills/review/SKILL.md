---
name: review
description: Review a change in this repo — a branch, a PR, or work in progress — for whether it does what was asked, follows the repo's standards, keeps the code easy to change, and is tested once per promise. Use for every code or test review in featherbase; it runs Matt Pocock's code-review and codebase-design skills and adds this repo's own checks.
---

# review

One review for code and tests. It leans on two of Matt Pocock's skills and adds
four checks of this repo's own. Report everything in one place.

## 1. Standards and spec

Run `mattpocock-skills:code-review` against the change: does it follow the
repo's documented standards, and does it do what the issue or spec asked?

## 2. Module shape (only when the change reshapes a module)

If the change adds a module or changes an interface, apply
`mattpocock-skills:codebase-design`'s deep-vs-shallow test to it: can a caller
use it without reading its body, and would deleting it push complexity back
into its callers? Skip this step for changes inside an existing module.

## 3. This repo's checks

- **One fact, one home.** For every list, threshold, default or name the
  change touches, search the whole repo for other copies, including ones
  under a different name or written inline. More than one copy is a finding;
  the fix is one definition (in `packages/shared` when both server and web
  use it) imported everywhere.
- **One word, one meaning.** A name says what it holds, without needing a
  comment. A word means the same thing everywhere in the repo; if it already
  means something else elsewhere, that is a finding.
- **Tests are MECE over promises.** List what the change promises, then map
  its tests onto that list. A promise with no test is a gap; several tests for
  one promise are duplicates. Each test must fail when its promise breaks:
  a stub or mock that answers the very thing under test proves nothing.
  When unsure, break one line of the code in a scratch worktree and see which
  tests go red.
- **E2E tests use the Feather testing DSL.** End-to-end tests go through
  `feather-testing-core`'s chainable `session` (`visit`, `fillIn`,
  `clickButton`, `assertText`, …) from `apps/web/e2e/fixtures.ts`, not raw
  Playwright calls.

## Report

One list, most serious first. Each finding gives where it is, what breaks
when someone changes that code, and the fix. Say what you fixed in this change
and what you filed as an issue instead; fixing everything found usually widens
the change wrongly. File and function length are not findings.
