# Featherbase Explorer — the docs & features site

A single-file, phone-friendly site that interlinks the 2026 build
harness's feature inventory with their tests, code, and every design
document, plus a question log (localStorage, JSON export) and the todo
learning path.

> The feature board renders **frozen history**. Its statuses were
> self-attested by the sessions that built each feature in 2026-07, and
> the inventory was retired to `docs/archive/harness-2026/` on
> 2026-08-28 (issue #236). This site is that archive's one live
> consumer; the board is a record of the original build, not a current
> status page. What ships today is described by the capability specs in
> `docs/specs/` and proven by the suites CI runs.

## Build

```bash
node site/build.mjs
```

Zero dependencies. Reads
`docs/archive/harness-2026/harness/features.json`, scans
`apps/server/test`, `apps/web/{test,e2e}` and both `src` trees for
feature-ID mentions, renders the curated markdown library
(mini-renderer, no external packages), and writes:

- `site/index.html` — full standalone page. Open locally, host anywhere.
- `site/artifact.html` — the same content as a body fragment, for
  publishing as a Claude artifact.

Re-run after editing any doc; commit the rebuilt outputs. (Nothing
flips a feature status any more — the inventory is frozen.)

## Hosting options

- **Claude artifact** (what's live now): private URL, works on a phone,
  republished from a session with the Artifact tool.
- **GitHub Pages**: live — `.github/workflows/pages.yml` builds and
  deploys `site/` on every push to `main` that touches `site/**`,
  `docs/**` or `PROGRESS.md`, and turns Pages on via the API itself
  (`actions/configure-pages` with `enablement: true`).
- **Anywhere else**: it's one HTML file; `scp` it.

## Questions log

Notes are saved under the browser's `localStorage` key `fbx-notes-v1`
and exported from the Questions tab as JSON — drop the export into a
Claude session ("answer these against the codebase") to turn reading
questions into docs.
