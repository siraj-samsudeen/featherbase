# Tasks

## 1. Protect global row search at the server boundary

- [x] 1.1 Using the `tdd` skill, add failing server API regressions in a focused
  global-search permission test: an asymmetric own-row case where the allowed
  row matches by ID and the forbidden row matches only by title, plus a Data
  Scope case covering both directly chosen rows and rows that reference an
  allowed region. Add three sensitive-title cases: hidden-title-only search has
  no hit, visible ID search uses the ID fallback without leaking the title, and
  deeper field access can search and display the title; verify the targeted test
  fails on the current leaks before the fix.
- [x] 1.2 Reuse the query module's existing row-visibility and readable-field
  selection in global search, combine it with one grouped ID/readable-title
  match, and preserve unreadable-table skipping, connected-table exclusion,
  result caps and response shape; verify the targeted server test passes and
  `pnpm --filter server typecheck` succeeds.

## 2. Prove the visible experience

- [x] 2.1 Add a Feather testing-core Session DSL browser regression that signs
  in as a non-admin user limited to their own rows, searches a term shared by
  an allowed and forbidden customer, and observes exactly the allowed result.
  Give the allowed row a sensitive title and verify its row-ID search displays
  only the fallback ID; verify the focused browser test and
  `pnpm check:e2e-dsl` pass.

## 3. Review and handoff

- [x] 3.1 Run `pnpm check:specs`, the focused server and browser regressions,
  `pnpm --filter server typecheck`, and the repository smoke test; record the
  commands and decisive output.
- [x] 3.2 Run `feather-code-review` over the completed diff, resolve every
  in-scope correctness, security, standards and test-quality finding, and
  rerun each affected check until the review is clean.
- [x] 3.3 Append the verified change and exact commands to `PROGRESS.md`, commit
  the stable result without pushing it, and verify the worktree is clean.
