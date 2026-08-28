# Featherbase Explorer — the docs & features site (archived)

**Retired 2026-08-28** along with the rest of `docs/archive/harness-2026/`
(issue #236) — see that directory's `README.md` for why. This directory is
frozen history; the notes below describe how the site worked, not a live
deploy.

A single-file, phone-friendly site that interlinks the 2026 build
harness's feature inventory with their tests, code, and every design
document, plus a question log (localStorage, JSON export) and the todo
learning path.

> The feature board renders **frozen history**. Its statuses were
> self-attested by the sessions that built each feature in 2026-07, and
> the inventory was retired to `docs/archive/harness-2026/` on
> 2026-08-28 (issue #236). The board is a record of the original build,
> not a current status page. What ships today is described by the
> capability specs in `docs/specs/` and proven by the suites CI runs.

## Build

```bash
node docs/archive/harness-2026/site/build.mjs
```

(Run from the repo root.) Zero dependencies. Reads
`docs/archive/harness-2026/harness/features.json`, scans
`apps/server/test`, `apps/web/{test,e2e}` and both `src` trees for
feature-ID mentions, renders the curated markdown library
(mini-renderer, no external packages), and writes, next to itself:

- `index.html` — full standalone page. Open locally.
- `artifact.html` — the same content as a body fragment, for
  publishing as a Claude artifact.

Re-run after editing any doc; commit the rebuilt outputs. (Nothing
flips a feature status any more — the inventory is frozen.)

## Hosting

Never worked: `.github/workflows/pages.yml` was meant to build and deploy
`site/` on every push to `main` touching `site/**`, `docs/**` or
`PROGRESS.md`, self-provisioning GitHub Pages via
`actions/configure-pages`'s `enablement: true`. Pages was never actually
enabled on the repo, so all 56 runs of that workflow failed (one
cancelled) between 2026-07 and 2026-08-24 and nothing was ever published
— verified 2026-08-28, the Pages URL 404s. The workflow is deleted; see
the archive README for the full account. `index.html` still opens
straight from disk for anyone who wants to browse it.

## Questions log

Notes are saved under the browser's `localStorage` key `fbx-notes-v1`
and exported from the Questions tab as JSON — drop the export into a
Claude session ("answer these against the codebase") to turn reading
questions into docs.
