// Migration 0124 (27-Oct-2026, #551): an app's manifest field `apiVersion: 1`
// became `platformVersion: "2026-10"`. An installed app records the manifest it
// was installed from and a fingerprint of its shipped files; the rename changes
// both. The migration rebinds an installed version to its renamed files only
// when the rename is the ONLY difference from the files it recorded, and
// otherwise fails, changing nothing, so the release can retry once the files
// are restored.
import { describe, expect } from 'vitest'
import { resolve } from 'node:path'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { test as base } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { taskerClient } from './tasker-client'
import { artifactDigest, availableRuntimeVersions, discoverPackages } from '../src/runtime-packages'
import { loadInstalledApps } from '../src/apps'
import { applyMigrationFile } from '../src/migrate'
import { sql, withTransaction } from '../src/db'

const test = base.extend<{ admin: TestClient }>({
  admin: async ({ admin }, use) => use(taskerClient(admin)),
})

const MIGRATION = '0124_app_platform_version.ts'
const predecessor = resolve('../..', 'runtime-apps/fixtures/tasker-v2.2')
const current = resolve('../..', 'runtime-apps/tasker')

// A copy of an app directory, edited. Removed after the test body.
async function copyOf(source: string, edit: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(resolve('test/.migration-0124-'))
  await cp(source, directory, { recursive: true })
  await edit(directory)
  return directory
}

async function replaceIn(file: string, from: string, to: string) {
  const text = await readFile(file, 'utf8')
  if (!text.includes(from)) throw new Error(`${file} lacks ${from}`)
  await writeFile(file, text.replaceAll(from, to))
}

// The fingerprint the trial recorded for Tasker 2.2.0: its shipped files as
// origin/main built them, spelled out here as the lines that said apiVersion.
async function fingerprintBeforeRename() {
  const old = await copyOf(predecessor, async (directory) => {
    await replaceIn(resolve(directory, 'featherbase.json'), '"platformVersion": "2026-10"', '"apiVersion": 1')
    await replaceIn(resolve(directory, 'dist/server.mjs'), 'var platformVersion = "2026-10";', 'var apiVersion = 1;')
    await replaceIn(resolve(directory, 'dist/server.mjs'), '\n  platformVersion,\n', '\n  apiVersion,\n')
  })
  try { return await artifactDigest(old) } finally { await rm(old, { recursive: true, force: true }) }
}

// Tasker 2.2.0 as the live trial holds it before this release.
async function installedBeforeRename(admin: TestClient, fingerprint: string | null) {
  await discoverPackages([predecessor])
  await admin.post('/api/install_app', { name: 'tasker' })
  await sql`update installed_app
    set manifest = (manifest - 'platformVersion') || '{"apiVersion": 1}'::jsonb, artifact_digest = ${fingerprint}
    where name = 'tasker'`
}

// The migrator's own path: one transaction for the file and its ledger row.
async function migrate(paths: string[]) {
  await sql`delete from featherbase.migration where name = ${MIGRATION}`
  const saved = process.env.FEATHERBASE_APP_PATHS
  process.env.FEATHERBASE_APP_PATHS = JSON.stringify(paths)
  try { await withTransaction(() => applyMigrationFile(MIGRATION)) } finally {
    if (saved === undefined) delete process.env.FEATHERBASE_APP_PATHS
    else process.env.FEATHERBASE_APP_PATHS = saved
  }
}

async function recorded() {
  const [row] = await sql`select manifest, artifact_digest from installed_app where name = 'tasker'`
  return row as { manifest: Record<string, unknown>; artifact_digest: string | null }
}

const applied = async () => (await sql`select 1 from featherbase.migration where name = ${MIGRATION}`).length === 1

describe('0124: installed apps follow apiVersion becoming platformVersion', () => {
  test('the recorded manifest names the platform version', async ({ admin }) => {
    await installedBeforeRename(admin, await fingerprintBeforeRename())
    await migrate([predecessor, current])
    const { manifest } = await recorded()
    expect(manifest.platformVersion).toBe('2026-10')
    expect(manifest).not.toHaveProperty('apiVersion')
  })

  test('the installed version is bound to its renamed shipped files', async ({ admin }) => {
    await installedBeforeRename(admin, await fingerprintBeforeRename())
    await migrate([predecessor, current])
    await discoverPackages([predecessor, current])
    const shipped = availableRuntimeVersions().find(v => v.name === 'tasker' && v.version === '2.2.0')!
    expect((await recorded()).artifact_digest).toBe(shipped.digest)
  })

  test('a release without the installed version\'s files fails, naming it', async ({ admin }) => {
    await installedBeforeRename(admin, await fingerprintBeforeRename())
    await expect(migrate([current])).rejects.toThrow(/tasker@2\.2\.0.*FEATHERBASE_APP_PATHS/s)
  })

  test('a failed run changes nothing', async ({ admin }) => {
    const fingerprint = await fingerprintBeforeRename()
    await installedBeforeRename(admin, fingerprint)
    await migrate([current]).catch(() => {})
    expect(await recorded()).toMatchObject({ manifest: { apiVersion: 1 }, artifact_digest: fingerprint })
    expect(await applied()).toBe(false)
  })

  test('restoring the files lets the migration run again', async ({ admin }) => {
    await installedBeforeRename(admin, await fingerprintBeforeRename())
    await migrate([current]).catch(() => {})
    await migrate([predecessor, current])
    expect(await applied()).toBe(true)
  })

  test('files whose code differs beyond the rename are refused', async ({ admin }) => {
    await installedBeforeRename(admin, await fingerprintBeforeRename())
    const changed = await copyOf(predecessor, async (directory) => {
      const server = resolve(directory, 'dist/server.mjs')
      await writeFile(server, `${await readFile(server, 'utf8')}\nglobalThis.changed = true\n`)
    })
    try {
      await expect(migrate([changed, current])).rejects.toThrow(/tasker@2\.2\.0/)
    } finally { await rm(changed, { recursive: true, force: true }) }
  })

  test('an install with no fingerprint gets just the rename', async ({ admin }) => {
    await installedBeforeRename(admin, null)
    await migrate([])
    expect(await recorded()).toMatchObject({ manifest: { platformVersion: '2026-10' }, artifact_digest: null })
  })

  test('boot after the migration selects the installed 2.2.0, and an upgrade moves it to 2.3.0', async ({ admin }) => {
    await installedBeforeRename(admin, await fingerprintBeforeRename())
    await migrate([predecessor, current])
    await discoverPackages([predecessor, current])
    await loadInstalledApps()
    expect(await admin.get('/api/runtime_app_versions')).toEqual(['tasker@2.2.0'])
    const plan = await admin.post<{ planId: string }>('/api/preview_app_upgrade', { name: 'tasker', version: '2.3.0' })
    await admin.post('/api/upgrade_app', { name: 'tasker', version: '2.3.0', planId: plan.planId })
    await admin.post('/api/activate_app_upgrade', { name: 'tasker', version: '2.3.0' })
    expect(await admin.get('/api/runtime_app_versions')).toEqual(['tasker@2.3.0'])
  })
})
