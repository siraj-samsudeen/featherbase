// Migration 0124 (27-Oct-2026, #551): an app's manifest field `apiVersion: 1`
// became `platformVersion: "2026-10"`. An installed app records the manifest it
// was installed from and a fingerprint of its shipped files; both change with
// the rename. The migration rewrites the recorded field and re-records the
// fingerprint of the shipped files of the same version, but only when their
// declaration is exactly the one recorded.
import { describe, expect } from 'vitest'
import { resolve } from 'node:path'
import { test as base } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { taskerClient } from './tasker-client'
import { availableRuntimeVersions, discoverPackages } from '../src/runtime-packages'
import { loadInstalledApps } from '../src/apps'
import { sql } from '../src/db'
import { up } from '../migrations/0124_app_platform_version'

const test = base.extend<{ admin: TestClient }>({
  admin: async ({ admin }, use) => use(taskerClient(admin)),
})

const predecessor = resolve('../..', 'runtime-apps/fixtures/tasker-v2.2')
const current = resolve('../..', 'runtime-apps/tasker')

// Tasker 2.2.0 as the live trial holds it before this release: installed from
// files that said `apiVersion: 1`, so the recorded manifest and fingerprint are
// those of the old files.
async function installedBeforeRename(admin: TestClient) {
  await discoverPackages([predecessor])
  await admin.post('/api/install_app', { name: 'tasker' })
  await sql`update installed_app
    set manifest = (manifest - 'platformVersion') || '{"apiVersion": 1}'::jsonb,
        artifact_digest = 'fingerprint-of-the-files-before-the-rename'
    where name = 'tasker'`
}

async function recorded() {
  const [row] = await sql`select manifest, artifact_digest from installed_app where name = 'tasker'`
  return row as { manifest: Record<string, unknown>; artifact_digest: string }
}

describe('0124: installed apps follow apiVersion becoming platformVersion', () => {
  test('the recorded manifest names the platform version', async ({ admin }) => {
    await installedBeforeRename(admin)
    await up([predecessor, current])
    const { manifest } = await recorded()
    expect(manifest.platformVersion).toBe('2026-10')
    expect(manifest).not.toHaveProperty('apiVersion')
  })

  test('the installed version is bound to its renamed shipped files', async ({ admin }) => {
    await installedBeforeRename(admin)
    await up([predecessor, current])
    await discoverPackages([predecessor, current])
    const shipped = availableRuntimeVersions().find(v => v.name === 'tasker' && v.version === '2.2.0')!
    expect((await recorded()).artifact_digest).toBe(shipped.digest)
  })

  test('an installed Tasker upgrades to the current version afterwards', async ({ admin }) => {
    await installedBeforeRename(admin)
    await up([predecessor, current])
    await discoverPackages([predecessor, current])
    await loadInstalledApps()
    const plan = await admin.post<{ planId: string }>('/api/preview_app_upgrade', { name: 'tasker', version: '2.3.0' })
    await admin.post('/api/upgrade_app', { name: 'tasker', version: '2.3.0', planId: plan.planId })
    await admin.post('/api/activate_app_upgrade', { name: 'tasker', version: '2.3.0' })
    expect(await admin.get('/api/app_catalog')).toContainEqual({ name: 'tasker', title: 'Tasker', href: '/tasker/' })
  })

  test('shipped files declaring something else are not bound', async ({ admin }) => {
    await installedBeforeRename(admin)
    await sql`update installed_app set manifest = jsonb_set(manifest, '{title}', '"Not what shipped"') where name = 'tasker'`
    await up([predecessor, current])
    expect((await recorded()).artifact_digest).toBe('fingerprint-of-the-files-before-the-rename')
  })
})
