## Why

Feather Dash pinned the Dive it embeds to a version number in an instance setting, and the app code kept lists of which versions read which state. Every Dive release then meant a code change and a setting change on every instance. With many Dives coming that does not scale (#937). MotherDuck renders the latest saved version when the embed request names none, so saving a Dive is its release.

## What Changes

- The embed request names no version, so the reader always sees the latest saved Dive.
- **BREAKING** The `dive_version` App Setting and the `DIVE_VERSION` environment variable are removed, as are the app's lists of known Dive versions.
- Feather Dash always sends the compact Dive state, which the Sales Target Dive reads from v13.
- Last month always opens the interactive report, since the latest Dive (v14) shows the month it is given. The "can't show last month yet" fallback is removed.

## Capabilities

### Modified Capabilities

- `sales-target-report`: the interactive report is always the latest saved Dive, and last month always opens it.
- `app-management`: the editable setting in the locked-setting scenario is the embed service account, since the report version no longer exists.

## Impact

- `client-apps/jeyarama/dash`: `featherbase.json`, `src/server.ts`, `src/report.ts`, `src/page.ts`, `src/app.tsx`, README.
- `client-apps/jeyarama/instances/dash`: `instance-settings.json`, `instance.md`.
- The older platform sales-target page (`apps/server/src/sales-target.ts`), `env.ts`, `.env.example` files, `docs/DEPLOY.md`, the image check.
- Needs Sales Target Dive v14 saved on MotherDuck (data-warehouse#4630) before it merges: v13 ignores the month it is given.
