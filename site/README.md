# Featherbase Explorer — the docs & features site

A single-file, phone-friendly site that interlinks the 126 harness
features with their tests, code, and every design document, plus a
question log (localStorage, JSON export) and the todo learning path.

## Build

```bash
node site/build.mjs
```

Zero dependencies. Reads `harness/features.json`, scans
`apps/server/test`, `apps/web/{test,e2e}` and both `src` trees for
feature-ID mentions, renders the curated markdown library
(mini-renderer, no external packages), and writes:

- `site/index.html` — full standalone page. Open locally, host anywhere.
- `site/artifact.html` — the same content as a body fragment, for
  publishing as a Claude artifact.

Re-run after editing any doc or flipping a feature status; commit the
rebuilt outputs.

## Hosting options

- **Claude artifact** (what's live now): private URL, works on a phone,
  republished from a session with the Artifact tool.
- **GitHub Pages**: Settings → Pages → Source "GitHub Actions", then a
  trivial workflow uploading `site/` with `actions/upload-pages-artifact`
  + `actions/deploy-pages` (not committed yet — add when Pages is
  enabled, so pushes don't show a failing deploy in the meantime).
- **Anywhere else**: it's one HTML file; `scp` it.

## Questions log

Notes are saved under the browser's `localStorage` key `fbx-notes-v1`
and exported from the Questions tab as JSON — drop the export into a
Claude session ("answer these against the codebase") to turn reading
questions into docs.
