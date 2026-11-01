# Acceptance tests

Runs the fenced Gherkin in `openspec/**/spec.md` against the real app, with
cucumber-js (the spec-as-source workflow; `.agents/skills/acceptance-test-authoring`).

```bash
npm --prefix acceptance-tests ci              # once: its own npm project, not a pnpm workspace member
npm --prefix acceptance-tests test            # the effective spec: main specs plus active change deltas
npm --prefix acceptance-tests run test:specs  # main specs only, as they are
```

One command does it all. The hooks (`support/stack.js`) start the API and the
web app on their own database, `featherbase_acceptance_e2e`, dropped and
migrated fresh on every run through the e2e suite's own reset
(`pnpm --filter server e2e:serve`), and on their own ports, 8030 and 5203
(`ACCEPTANCE_API_PORT` / `ACCEPTANCE_WEB_PORT`). The browser is Playwright,
headless. Each run writes `reports/cucumber-report.html`, with a screenshot of
every failed scenario.

- `extract-gherkin.cjs`, `cucumber.cjs` and `openspec-effective-paths.cjs`
  are copied from the skill's references, unchanged. There is no separate spec
  lint: cucumber-js refuses malformed Gherkin on every run. A `#### Scenario:`
  with no gherkin fence (most main specs today are still prose) is left out,
  and the run names each one. While those prose specs are left out, a delta
  that modifies one of their requirements prints an `[effective-spec] WARNING
  ... no such rule` line; it is expected until the main spec is fenced.
- `.extracted/` and `reports/` are generated; never edit or commit them.
- Steps say what the user does and sees; screens, selectors and URLs live in
  the page objects under `support/pages/`.

## Watching and debugging

For a person at their own screen; agents and CI set none of these.

| Setting | What it does |
|---|---|
| `HEADED=1` | A visible browser, slowed down so each action can be followed. |
| `PWDEBUG=1` | Playwright's Inspector (headed), pausing before each action; no step timeout. |
| `VIDEO=1` | A slowed-down, headless video of every scenario, one per browser (System Manager, the user, a colleague): `reports/videos/<NN>-<scenario>[-<who>].webm`, numbered in run order. A change's scenarios run in journey order, the order its `proposal.md` lists its capabilities, so the videos follow it too. Each step's text shows as a caption at the top of every page, and each Then holds for 1.5s so its result can be seen. |
| `VIDEO_SLOWMO=<ms>` | How slow a `VIDEO=1` run is, per browser action (default 400). |

In CI (or with `TRACE=1`) every scenario's browsers are traced; a failed scenario keeps its traces as
`reports/traces/<scenario>[-<who>].zip` (CI uploads them with the report).
Open one with:

```bash
npx --prefix acceptance-tests playwright show-trace acceptance-tests/reports/traces/<scenario>.zip
```

```bash
VIDEO=1 npm --prefix acceptance-tests test
npm --prefix acceptance-tests run video:journey   # then join them into one video
```

`video:journey` joins the last `VIDEO=1` run's videos, in run order, into
`reports/videos/journey.mp4`, each after a 2-second title card
"NN · scenario — who"; phone clips are padded onto the same 1280×900 canvas.
It needs a working ffmpeg (`FFMPEG=<path>`, else `ffmpeg` on `PATH`, else
`/opt/homebrew/bin/ffmpeg`) and says so when there is none.
