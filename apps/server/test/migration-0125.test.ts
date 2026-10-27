// Migration 0125 (27-Oct-2026, #551): an app's manifest field `apiVersion: 1`
// became `platformVersion: "2026-10"`. An installed app records the manifest it
// was installed from and a fingerprint of its shipped files; the rename changes
// both. The migration rebinds an installed version to its renamed files only
// when the rename is the ONLY difference from the files it recorded, and
// otherwise fails, changing nothing, so the release can retry once the files
// are restored.
import { describe, expect } from 'vitest'
import { relative, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
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

const MIGRATION = '0125_app_platform_version.ts'
const predecessor = resolve('../..', 'runtime-apps/fixtures/tasker-v2.2')
const current = resolve('../..', 'runtime-apps/tasker')

// A copy of an app directory, edited. Removed after the test body.
async function copyOf(source: string, edit: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(resolve('test/.migration-0125-'))
  await cp(source, directory, { recursive: true })
  await edit(directory)
  return directory
}

// The fingerprint a checkout recorded for Tasker 2.2.0 before the rename: the
// real files of the 2.2 fixture at BEFORE_RENAME.
async function fingerprintBeforeRename() {
  const old = await realFilesBeforeRename(predecessor, false)
  try { return await artifactDigest(old) } finally { await rm(old, { recursive: true, force: true }) }
}

// The last origin/main commit before the rename. CI's server job fetches full
// history; a shallow local checkout must fetch this commit.
const BEFORE_RENAME = 'd5b9fd5b8b564b8d639b5bb9ea6d104bf407ba6e'
const repo = resolve('../..')

// vite's client bundle depends on NODE_ENV. CI sets NODE_ENV=test for the
// whole job, `pnpm apps:prepare` included, and local runs do not, so the
// prepared dist/ differs between them. Both sides of a built comparison are
// therefore built here, the same way: with `source`'s installed packages, and
// the app's own build with NODE_ENV stripped.
async function buildIn(directory: string, source: string) {
  await symlink(resolve(source, 'node_modules'), resolve(directory, 'node_modules'))
  const { NODE_ENV: _runner, ...env } = process.env
  execFileSync('npm', ['run', 'build', '--silent'], { cwd: directory, stdio: 'ignore', env })
}

// The real files of an app directory at BEFORE_RENAME, laid out as init.sh
// uses them; `build` runs the app's own build.
async function realFilesBeforeRename(directory: string, build: boolean) {
  const old = await mkdtemp(resolve('test/.migration-0125-origin-'))
  const path = relative(repo, directory)
  const archive = execFileSync('git', ['archive', BEFORE_RENAME, path], { cwd: repo, maxBuffer: 50 * 1024 * 1024 })
  execFileSync('tar', ['-x', '-C', old, '--strip-components', String(path.split('/').length)], { input: archive })
  if (build) await buildIn(old, directory)
  return old
}

// This branch's files of an app directory, built here rather than taken from
// the prepared dist/ (see buildIn).
async function builtCopyOf(source: string) {
  const copy = await mkdtemp(resolve('test/.migration-0125-branch-'))
  await cp(source, copy, { recursive: true, filter: (file) => !['node_modules', 'dist'].includes(relative(source, file).split('/')[0]) })
  await buildIn(copy, source)
  return copy
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

describe('0125: installed apps follow apiVersion becoming platformVersion', () => {
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

  // Codex round 2: init.sh points FEATHERBASE_APP_PATHS at the source
  // directories, so the recorded fingerprint covers src/ too. These take the
  // real files from origin/main as init.sh lays them out (the 2.2 fixture as
  // committed; Tasker 2.3.0 built by its own build), record that fingerprint,
  // and swap in this branch's files. A built version's renamed side is built
  // here too, the same way (see buildIn).
  for (const [version, source, build] of [['2.2.0', predecessor, false], ['2.3.0', current, true]] as const)
    test(`a checkout that installed Tasker ${version} from origin/main rebinds and boots`, async ({ admin }) => {
      const old = await realFilesBeforeRename(source, build)
      const renamed = build ? await builtCopyOf(source) : source
      const paths = build ? [predecessor, renamed] : [predecessor, current]
      try {
        await discoverPackages([renamed])
        await admin.post('/api/install_app', { name: 'tasker' })
        await sql`update installed_app
          set manifest = (manifest - 'platformVersion') || '{"apiVersion": 1}'::jsonb, artifact_digest = ${await artifactDigest(old)}
          where name = 'tasker'`
        await migrate(paths)
        await discoverPackages(paths)
        await loadInstalledApps()
        expect(await admin.get('/api/runtime_app_versions')).toEqual([`tasker@${version}`])
      } finally {
        await rm(old, { recursive: true, force: true })
        if (build) await rm(renamed, { recursive: true, force: true })
      }
    }, 180_000)

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
