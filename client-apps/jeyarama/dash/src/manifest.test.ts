// The platform's own loader is the judge of the manifest: this runs
// featherbase's boot discovery loading (unshippedApps, which the release guard
// shares) over this folder, with this repository's server and its own tsx.
// Build first (npm run build): the loader needs dist/server.mjs and
// dist/client/index.html, exactly as the image ships them.
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import pkg from '../package.json' with { type: 'json' }

// This repository's root (client-apps/jeyarama/dash/src → four levels up), with `pnpm install` run.
const checkout = resolve(import.meta.dirname, '../../../..')
const appDir = resolve(import.meta.dirname, '..')

describe('the featherbase manifest', () => {
  it('is accepted by the platform\'s app loader', () => {
    const server = resolve(checkout, 'apps/server')
    const output = execFileSync(resolve(server, 'node_modules/.bin/tsx'),
      [resolve(appDir, 'scripts/platform-loads-app.mts'), checkout, appDir], { cwd: server, encoding: 'utf8' })
    expect(JSON.parse(output.trim().split('\n').at(-1)!)).toMatchObject({ name: 'feather_dash', version: pkg.version, accepted: true })
  }, 60_000)
})
