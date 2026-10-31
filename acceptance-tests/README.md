# Acceptance tests

Runs the fenced Gherkin in `openspec/**/spec.md` against the real app, with
cucumber-js (the spec-as-source workflow; `.agents/skills/acceptance-test-authoring`).

```bash
npm --prefix acceptance-tests ci              # once: its own npm project, not a pnpm workspace member
npm --prefix acceptance-tests test            # the effective spec: main specs plus active change deltas
npm --prefix acceptance-tests run test:specs  # main specs only, as they are
npm --prefix acceptance-tests run lint:specs  # gherklin over the extracted specs (CI runs it)
```

One command does it all. The hooks (`support/stack.js`) start the API and the
web app on their own database, `featherbase_acceptance_e2e`, dropped and
migrated fresh on every run through the e2e suite's own reset
(`pnpm --filter server e2e:serve`), and on their own ports, 8030 and 5203
(`ACCEPTANCE_API_PORT` / `ACCEPTANCE_WEB_PORT`). The browser is Playwright,
headless. Each run writes `reports/cucumber-report.html`, with a screenshot of
every failed scenario.

- `extract-gherkin.cjs`, `cucumber.cjs` and `openspec-effective-paths.cjs`
  are copied from the skill's references. The spec lint is gherklin, not the
  skill's gherkin-lint (unmaintained, and its dependencies fail `npm audit`):
  `gherklin.config.yaml` ports the skill's `.gherkin-lintrc`, with the rules
  gherklin lacks written in `gherklin-rules/`. One local change in
  `extract-gherkin.cjs`: a `spec.md` with no gherkin fence (most main specs
  today are still prose) is not extracted, and the run says how many.
  While those prose specs are left out, a delta that modifies one of their
  requirements prints an `[effective-spec] WARNING ... no such rule` line; it is
  expected until the main spec is fenced.
- `.extracted/` and `reports/` are generated; never edit or commit them.
- Steps say what the user does and sees; screens, selectors and URLs live in
  the page objects under `support/pages/`.
