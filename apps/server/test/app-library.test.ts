import { expect } from 'vitest'
import { test } from './pg-test'
import { committedTest } from './pg-test-shared'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { discoverAppLibrary } from '../src/app-library'
import { loadInstalledApps } from '../src/apps'
import { installedAppsAtStart } from '../src/release-preflight'
import { sql } from '../src/db'
import { withNamedVariable } from '../src/env'
import { makeClient } from 'feather-testing-postgres'
import { main } from '../src/cli'
import { runMain } from './command-io'
import { expectRefused, expectStatus } from './fixtures'

async function sourceRepository(build = `node -e "require('fs').copyFileSync('server.mjs', 'built.mjs')"`) {
  const root = await mkdtemp(resolve('test/.app-library-'))
  await mkdir(resolve(root, '.git'))
  const source = resolve(root, 'example-apps/other')
  await cp(resolve('../..', 'test-apps/other'), source, { recursive: true })
  const file = resolve(source, 'featherbase.json')
  const manifest = JSON.parse(await readFile(file, 'utf8'))
  await writeFile(file, JSON.stringify({ ...manifest, server: 'built.mjs', secrets: ['CATALOG_TEST_SECRET'] }))
  await writeFile(resolve(source, 'package.json'), JSON.stringify({ name: 'catalog-test', version: '0.0.1', type: 'module', scripts: { build } }))
  return root
}

test('the manager catalog offers repository apps without registering their code', async ({ admin }) => {
  const result = await admin.get<{ available: string[]; catalog: { name: string; title: string; preparation: { state: string }; installed: boolean }[] }>('/api/apps')
  expect(result.catalog).toContainEqual(expect.objectContaining({ name: 'tasker', title: 'Tasker', installed: false, preparation: { state: 'needed' } }))
  expect(result.catalog).toContainEqual(expect.objectContaining({ name: 'dash', title: 'Dash', installed: false }))
  expect(result.catalog.map(app => app.name)).not.toContain('other')
  expect(result.available).not.toContain('tasker')
})

test('ambiguous source packages and folders without repository metadata are not offered', async ({ admin }) => {
  const root = await sourceRepository()
  try {
    const source = resolve(root, 'example-apps/other')
    for (const copy of ['duplicate', 'third'])
      await cp(source, resolve(root, `example-apps/${copy}`), { recursive: true })
    const second = resolve(root, 'client-apps/customer/second')
    await cp(source, second, { recursive: true })
    for (const file of ['featherbase.json', 'server.mjs']) {
      const path = resolve(second, file)
      await writeFile(path, (await readFile(path, 'utf8')).replaceAll('other', 'second'))
    }
    await discoverAppLibrary([], root)
    const catalog = await admin.get<{ catalog: { name: string }[] }>('/api/apps')
    expect(catalog.catalog.map(app => app.name)).toEqual(['second'])
    await expect(admin.post('/api/apps/prepare-install', { name: 'other' })).rejects.toMatchObject({
      status: 417, message: expect.stringContaining('Unknown trusted app name'),
    })
    expect(await sql`select name from installed_app where name in ('other', 'second')`).toEqual([])
    for (const copy of ['duplicate', 'third']) await rm(resolve(root, `example-apps/${copy}`), { recursive: true })
    await rm(resolve(root, '.git'), { recursive: true })
    await discoverAppLibrary([], root)
    expect(await admin.get('/api/apps')).toMatchObject({ catalog: [] })
    await expect(readFile(resolve(source, 'built.mjs'))).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    await discoverAppLibrary([], null)
    await rm(root, { recursive: true, force: true })
  }
})

test('an already-built trusted package installs without executing its source build', async ({ admin }) => {
  const root = await sourceRepository('node -e "process.exit(1)"')
  const source = resolve(root, 'example-apps/other')
  try {
    await cp(resolve(source, 'server.mjs'), resolve(source, 'built.mjs'))
    await discoverAppLibrary([source], null)
    expect(await admin.get('/api/apps')).toMatchObject({ catalog: [expect.objectContaining({ name: 'other', installed: false, preparation: { state: 'ready' } })] })
    expect(await admin.post('/api/apps/prepare-install', { name: 'other' })).toEqual({ name: 'other', installed: true })
    expect(await admin.get('/api/apps')).toMatchObject({ catalog: [expect.objectContaining({ name: 'other', installed: true, active: true })] })
    expect(await sql`select name, package_version from installed_app where name = 'other'`).toEqual([{ name: 'other', package_version: '0.0.1' }])
  } finally {
    await discoverAppLibrary([], null)
    await loadInstalledApps()
    await rm(root, { recursive: true, force: true })
  }
})

test('an invalid source declaration is not offered for installation', async ({ admin }) => {
  const root = await sourceRepository()
  try {
    await writeFile(resolve(root, 'example-apps/other/featherbase.json'), '{invalid')
    await discoverAppLibrary([], root)
    expect((await admin.get<{ catalog: unknown[] }>('/api/apps')).catalog).toEqual([])
    await expectRefused(admin.post('/api/apps/prepare-install', { name: 'other' }), 417)
  } finally {
    await discoverAppLibrary([], null)
    await rm(root, { recursive: true, force: true })
  }
})

test('an explicit choice builds a trusted source app before installing it', async ({ admin }) => {
  const root = await sourceRepository()
  try {
    await discoverAppLibrary([], root)
    expect(await admin.post('/api/apps/prepare-install', { name: 'other' })).toMatchObject({ name: 'other', installed: true })
    expect(await admin.get('/api/apps')).toMatchObject({ catalog: [expect.objectContaining({ name: 'other', installed: true, active: true, preparation: { state: 'ready' } })] })
    expect(await sql`select name from installed_app where name = 'other'`).toHaveLength(1)
  } finally {
    await discoverAppLibrary([], null)
    await loadInstalledApps()
    await rm(root, { recursive: true, force: true })
  }
})

test('an unavailable installed app retains its catalog details', async ({ admin }) => {
  const root = await sourceRepository()
  try {
    await discoverAppLibrary([], root)
    await admin.post('/api/apps/prepare-install', { name: 'other' })
    await discoverAppLibrary([], null)
    await loadInstalledApps()
    expect(await admin.get('/api/apps')).toMatchObject({ catalog: [expect.objectContaining({ name: 'other', installed: true, active: false, preparation: { state: 'unavailable' } })] })
  } finally {
    await discoverAppLibrary([], null)
    await loadInstalledApps()
    await rm(root, { recursive: true, force: true })
  }
})

test('simultaneous prepare requests build the app only once', async ({ admin }) => {
  const root = await sourceRepository(`node -e "setTimeout(() => require('fs').copyFileSync('server.mjs','built.mjs'), 250)"`)
  try {
    await discoverAppLibrary([], root)
    const responses = await Promise.all([
      admin.fetch('/api/apps/prepare-install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'other' }) }),
      admin.fetch('/api/apps/prepare-install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'other' }) }),
    ])
    expect(responses.map(response => response.status).sort()).toEqual([201, 409])
  } finally {
    await discoverAppLibrary([], null)
    await loadInstalledApps()
    await rm(root, { recursive: true, force: true })
  }
})

test('failed preparation reports an actionable state without installing', async ({ admin }) => {
  const root = await sourceRepository('node -e "process.exit(1)"')
  try {
    await discoverAppLibrary([], root)
    await expectRefused(admin.post('/api/apps/prepare-install', { name: 'other' }), 417, 'build dependencies')
    expect(await admin.get('/api/apps')).toMatchObject({ catalog: [expect.objectContaining({ name: 'other', installed: false, preparation: { state: 'failed', error: expect.stringContaining('retry') } })] })
    expect(await sql`select name from installed_app where name = 'other'`).toHaveLength(0)
  } finally {
    await discoverAppLibrary([], null)
    await loadInstalledApps()
    await rm(root, { recursive: true, force: true })
  }
})

committedTest('preparation progress remains inspectable while the build runs', async ({ admin }) => {
  const root = await sourceRepository(`node -e "setTimeout(() => require('fs').copyFileSync('server.mjs','built.mjs'), 350)"`)
  let request: Promise<unknown> | undefined
  try {
    await discoverAppLibrary([], root)
    request = admin.post('/api/apps/prepare-install', { name: 'other' })
    await expect.poll(async () => (await admin.get<{ catalog: { preparation: { state: string } }[] }>('/api/apps')).catalog[0].preparation.state).toBe('preparing')
    await request
  } finally {
    await request
    await discoverAppLibrary([], null)
    await loadInstalledApps()
    await rm(root, { recursive: true, force: true })
  }
})

test('the catalog returns secret presence without values or package paths', async ({ admin }) => {
  const root = await sourceRepository()
  const file = resolve(root, 'example-apps/other/featherbase.json')
  const manifest = JSON.parse(await readFile(file, 'utf8'))
  manifest.secrets.push({ name: 'CATALOG_OPTIONAL_SECRET', optional: true })
  await writeFile(file, JSON.stringify(manifest))
  try {
    await discoverAppLibrary([], root)
    for (const absent of [undefined, '   ']) {
      await withNamedVariable('CATALOG_TEST_SECRET', 'not-for-the-browser', () => withNamedVariable('CATALOG_OPTIONAL_SECRET', absent, async () => {
        const result = await admin.get<{ catalog: { secrets: unknown[] }[] }>('/api/apps')
        expect(result.catalog[0].secrets).toEqual([
          { name: 'CATALOG_TEST_SECRET', optional: false, present: true },
          { name: 'CATALOG_OPTIONAL_SECRET', optional: true, present: false },
        ])
        expect(JSON.stringify(result)).not.toMatch(/not-for-the-browser|built\.mjs|server\.mjs|app-library-/)
      }))
    }
    await withNamedVariable('CATALOG_TEST_SECRET', undefined, () => withNamedVariable('CATALOG_OPTIONAL_SECRET', 'optional-not-for-the-browser', async () => {
      const result = await admin.get<{ catalog: { secrets: unknown[] }[] }>('/api/apps')
      expect(result.catalog[0].secrets).toEqual([
        { name: 'CATALOG_TEST_SECRET', optional: false, present: false },
        { name: 'CATALOG_OPTIONAL_SECRET', optional: true, present: true },
      ])
      expect(JSON.stringify(result)).not.toContain('optional-not-for-the-browser')
    }))
  } finally {
    await discoverAppLibrary([], null)
    await rm(root, { recursive: true, force: true })
  }
})

test('a colleague cannot prepare a trusted app', async ({ createUser }) => {
  const root = await sourceRepository()
  try {
    await discoverAppLibrary([], root)
    const member = await createUser({ email: 'catalog-member@example.com', roles: [] })
    await expectRefused(member.get('/api/apps'), 403)
    await expectRefused(member.post('/api/apps/prepare-install', { name: 'other' }), 403)
    await expect(readFile(resolve(root, 'example-apps/other/built.mjs'))).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    await discoverAppLibrary([], null)
    await rm(root, { recursive: true, force: true })
  }
})

test('preparation accepts catalog names rather than paths or build commands', async ({ admin }) => {
  for (const body of [{ name: '../other' }, { name: 'unknown' }, { name: 'other', path: '/tmp' }, { name: 'other', command: 'echo unsafe' }, {}, null])
    await expectRefused(admin.post('/api/apps/prepare-install', body), 417)
  const malformed = await admin.fetch('/api/apps/prepare-install', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
  })
  await expectStatus(malformed, 417)
  expect(await malformed.json()).toMatchObject({ error: { type: 'ValidationError', message: 'Expected { name } naming an app in the catalog; paths and commands are not accepted' } })
  expect(await sql`select name from installed_app`).toEqual([])
})

test('restart reactivates an installed repository app without explicit paths', async ({ admin }) => {
  const root = await sourceRepository()
  const client = makeClient({ request: (path, init) => admin.fetch(String(path), { ...init, headers: { 'X-Featherbase-App-Version': 'other@0.0.1', ...init?.headers } }) }, admin.token, admin.user)
  try {
    await withNamedVariable('FEATHERBASE_APP_PATHS', undefined, async () => {
      await discoverAppLibrary([], root)
      await admin.post('/api/apps/prepare-install', { name: 'other' })
      await client.post('/api/save_row', { table: 'other.task', row: { row_id: 'survivor', quantity: 21 } })
      await discoverAppLibrary([], root)
      await loadInstalledApps()
      expect(await client.get('/api/table/other.task/survivor')).toMatchObject({ quantity: 21, validation_runs: 1 })
      await expect(installedAppsAtStart('production')).resolves.toEqual([])
      await expectRefused(admin.post('/api/apps/prepare-install', { name: 'other' }), 409)
    })
  } finally {
    await discoverAppLibrary([], null)
    await loadInstalledApps()
    await rm(root, { recursive: true, force: true })
  }
})

test('preparing a second app preserves the running first app registration', async ({ admin }) => {
  const root = await sourceRepository()
  const second = resolve(root, 'client-apps/customer/second')
  await cp(resolve(root, 'example-apps/other'), second, { recursive: true })
  for (const file of ['featherbase.json', 'server.mjs']) {
    const path = resolve(second, file)
    await writeFile(path, (await readFile(path, 'utf8')).replaceAll('other', 'second'))
  }
  const client = makeClient({ request: (path, init) => admin.fetch(String(path), { ...init, headers: { 'X-Featherbase-App-Version': 'other@0.0.1', ...init?.headers } }) }, admin.token, admin.user)
  try {
    await discoverAppLibrary([], root)
    await admin.post('/api/apps/prepare-install', { name: 'other' })
    await admin.post('/api/apps/prepare-install', { name: 'second' })
    expect(await client.post('/api/save_row', { table: 'other.task', row: { row_id: 'still-wired', quantity: 6 } })).toMatchObject({ validation_runs: 1 })
    expect(await admin.get('/api/runtime_app_versions')).toEqual(['other@0.0.1', 'second@0.0.1'])
  } finally {
    await discoverAppLibrary([], null)
    await loadInstalledApps()
    await rm(root, { recursive: true, force: true })
  }
})

test('a retry uses the repaired source after installation validation failed', async ({ admin }) => {
  const root = await sourceRepository()
  const file = resolve(root, 'example-apps/other/featherbase.json')
  const original = await readFile(file, 'utf8')
  try {
    const manifest = JSON.parse(original)
    manifest.permissions[0].role = 'Unknown catalog role'
    await writeFile(file, JSON.stringify(manifest))
    await discoverAppLibrary([], root)
    await expectRefused(admin.post('/api/apps/prepare-install', { name: 'other' }), 417, 'unknown role Unknown catalog role')
    await writeFile(file, original)
    await discoverAppLibrary([], root)
    expect(await admin.post('/api/apps/prepare-install', { name: 'other' })).toEqual({ name: 'other', installed: true })
  } finally {
    await discoverAppLibrary([], null)
    await loadInstalledApps()
    await rm(root, { recursive: true, force: true })
  }
})

for (const { stamp, edit, active } of [
  { stamp: 'development', edit: 'code', active: true },
  { stamp: 'development', edit: 'package formatting', active: true },
  { stamp: 'production', edit: 'code', active: false },
  { stamp: 'development', edit: 'manifest', active: false },
]) test(`${stamp} database reload after ${edit} edit has active=${active}`, async ({ admin }) => {
  const root = await sourceRepository()
  const source = resolve(root, 'example-apps/other')
  const client = makeClient({ request: (path, init) => admin.fetch(String(path), { ...init, headers: { 'X-Featherbase-App-Version': 'other@0.0.1', ...init?.headers } }) }, admin.token, admin.user)
  try {
    await discoverAppLibrary([], root)
    await admin.post('/api/apps/prepare-install', { name: 'other' })
    await client.post('/api/save_row', { table: 'other.task', row: { row_id: 'edited-survivor', quantity: 34 } })
    const [before] = await sql`select artifact_digest from installed_app where name = 'other'`
    await sql`update internal_metadata set value = ${stamp} where key = 'environment'`
    const file = resolve(source, edit === 'code' ? 'built.mjs' : edit === 'manifest' ? 'featherbase.json' : 'package.json')
    const original = await readFile(file, 'utf8')
    await writeFile(file, edit === 'code' ? `${original}\n// local development edit\n` : edit === 'manifest'
      ? JSON.stringify({ ...JSON.parse(original), title: 'Changed declaration' })
      : JSON.stringify(JSON.parse(original), null, 2))
    await withNamedVariable('FEATHERBASE_ENV', 'development', async () => {
      if (stamp === 'development' && edit === 'code') {
        const repinned = await withNamedVariable('FEATHERBASE_APP_PATHS', '[]', () => runMain(main, ['install-app', 'other']))
        expect(repinned.code).toBe(0)
        expect(repinned.stdout).toContain('other is already installed; re-pinned to its folder as it is now')
        const [afterCli] = await sql`select artifact_digest from installed_app where name = 'other'`
        expect(afterCli.artifact_digest).not.toBe(before.artifact_digest)
      }
      await discoverAppLibrary([], root)
      await loadInstalledApps()
    })
    expect(await admin.get('/api/apps')).toMatchObject({ catalog: [expect.objectContaining({ name: 'other', installed: true, active })] })
    const [after] = await sql`select artifact_digest from installed_app where name = 'other'`
    if (active) {
      expect(after.artifact_digest).not.toBe(before.artifact_digest)
      expect(await client.get('/api/table/other.task/edited-survivor')).toMatchObject({ quantity: 34, validation_runs: 1 })
      expect(await client.post('/api/save_row', { table: 'other.task', row: { row_id: 'after-edit', quantity: 8 } })).toMatchObject({ validation_runs: 1 })
    } else {
      expect(after.artifact_digest).toBe(before.artifact_digest)
      expect(await sql`select quantity from other.task where row_id = 'edited-survivor'`).toEqual([{ quantity: 34 }])
      const refused = await withNamedVariable('FEATHERBASE_APP_PATHS', '[]', () => runMain(main, ['install-app', 'other']))
      expect(refused.code).toBe(1)
      expect(refused.stderr).toContain('other on this database is not the other in its folder')
      expect(await sql`select artifact_digest from installed_app where name = 'other'`).toEqual([before])
      expect(await sql`select quantity from other.task where row_id = 'edited-survivor'`).toEqual([{ quantity: 34 }])
      const reinstall = await runMain(main, ['install-app', 'other'])
      expect(reinstall.code).toBe(1)
      expect(reinstall.stderr).toContain('Upgrade it')
      expect(await sql`select artifact_digest from installed_app where name = 'other'`).toEqual([before])
      expect(await sql`select quantity from other.task where row_id = 'edited-survivor'`).toEqual([{ quantity: 34 }])
    }
  } finally {
    await discoverAppLibrary([], null)
    await loadInstalledApps()
    await rm(root, { recursive: true, force: true })
  }
})

test('source build receives no server secrets or production dependency omission', async ({ admin }) => {
  const root = await sourceRepository('node build-probe.mjs')
  const source = resolve(root, 'example-apps/other')
  await writeFile(resolve(source, 'build-probe.mjs'), `import { writeFileSync, copyFileSync } from 'node:fs'
writeFileSync('build-env.json', JSON.stringify({ database: !!process.env.DATABASE_URL, secret: !!process.env.CATALOG_TEST_SECRET, nodeEnv: process.env.NODE_ENV ?? null, omitDev: (process.env.npm_config_omit ?? '').split(',').includes('dev') }))
copyFileSync('server.mjs', 'built.mjs')
`)
  try {
    await discoverAppLibrary([], root)
    await withNamedVariable('CATALOG_TEST_SECRET', 'build-must-not-see-this', () =>
      withNamedVariable('NODE_ENV', 'production', () =>
        withNamedVariable('npm_config_omit', 'dev', () => admin.post('/api/apps/prepare-install', { name: 'other' }))))
    expect(JSON.parse(await readFile(resolve(source, 'build-env.json'), 'utf8'))).toEqual({ database: false, secret: false, nodeEnv: null, omitDev: false })
  } finally {
    await discoverAppLibrary([], null)
    await loadInstalledApps()
    await rm(root, { recursive: true, force: true })
  }
})

for (const edit of ['permissions', 'package version']) test(`a changed ${edit} after catalog discovery refuses before building`, async ({ admin }) => {
  const root = await sourceRepository()
  const source = resolve(root, 'example-apps/other')
  try {
    await discoverAppLibrary([], root)
    const file = resolve(source, edit === 'permissions' ? 'featherbase.json' : 'package.json')
    const declaration = JSON.parse(await readFile(file, 'utf8'))
    if (edit === 'permissions') declaration.permissions[0].can_write = true
    else declaration.version = '0.0.2'
    await writeFile(file, JSON.stringify(declaration))
    await expectRefused(admin.post('/api/apps/prepare-install', { name: 'other' }), 409, 'changed since discovery')
    await expect(readFile(resolve(source, 'built.mjs'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await sql`select name from installed_app where name = 'other'`).toHaveLength(0)
  } finally {
    await discoverAppLibrary([], null)
    await loadInstalledApps()
    await rm(root, { recursive: true, force: true })
  }
})

test('a manifest changed by the source build is not installed', async ({ admin }) => {
  const root = await sourceRepository('node change-manifest.mjs')
  const source = resolve(root, 'example-apps/other')
  await writeFile(resolve(source, 'change-manifest.mjs'), `import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
const manifest = JSON.parse(readFileSync('featherbase.json', 'utf8'))
manifest.permissions[0].can_write = true
writeFileSync('featherbase.json', JSON.stringify(manifest))
copyFileSync('server.mjs', 'built.mjs')
`)
  try {
    await discoverAppLibrary([], root)
    await expectRefused(admin.post('/api/apps/prepare-install', { name: 'other' }), 409, 'changed since discovery')
    expect(await readFile(resolve(source, 'built.mjs'), 'utf8')).toContain('other.task')
    expect(await sql`select name from installed_app where name = 'other'`).toHaveLength(0)
  } finally {
    await discoverAppLibrary([], null)
    await loadInstalledApps()
    await rm(root, { recursive: true, force: true })
  }
})

committedTest('a concurrent successful installation is not reported as failed preparation', async ({ admin }) => {
  const root = await sourceRepository(`node -e "setTimeout(() => require('fs').copyFileSync('server.mjs','built.mjs'), 250)"`)
  const file = resolve(root, 'example-apps/other/featherbase.json')
  const manifest = JSON.parse(await readFile(file, 'utf8'))
  manifest.permissions[0].role = 'Catalog reviewer'
  await writeFile(file, JSON.stringify(manifest))
  let retry: Promise<Response> | undefined
  try {
    await discoverAppLibrary([], root)
    await expectRefused(admin.post('/api/apps/prepare-install', { name: 'other' }), 417)
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Catalog reviewer' } })
    retry = admin.fetch('/api/apps/prepare-install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'other' }) })
    await expect.poll(async () => (await admin.get<{ catalog: { preparation: { state: string } }[] }>('/api/apps')).catalog[0].preparation.state).toBe('preparing')
    await admin.post('/api/install_app', { name: 'other' })
    await expectStatus(await retry, 409)
    expect(await admin.get('/api/apps')).toMatchObject({ catalog: [expect.objectContaining({ name: 'other', installed: true, active: true, preparation: { state: 'ready' } })] })
  } finally {
    await retry
    await discoverAppLibrary([], null)
    await loadInstalledApps()
    await rm(root, { recursive: true, force: true })
  }
})

committedTest('a second preparation of an app still being prepared is refused', async ({ admin }) => {
  const root = await sourceRepository(`node -e "setTimeout(() => require('fs').copyFileSync('server.mjs','built.mjs'), 350)"`)
  let request: Promise<unknown> | undefined
  try {
    await discoverAppLibrary([], root)
    request = admin.post('/api/apps/prepare-install', { name: 'other' })
    await expect.poll(async () => (await admin.get<{ catalog: { preparation: { state: string } }[] }>('/api/apps')).catalog[0].preparation.state).toBe('preparing')
    await expectRefused(admin.post('/api/apps/prepare-install', { name: 'other' }), 409, 'App other is already being prepared')
    await request
  } finally {
    await request
    await discoverAppLibrary([], null)
    await loadInstalledApps()
    await rm(root, { recursive: true, force: true })
  }
})
