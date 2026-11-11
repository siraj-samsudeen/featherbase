// #1178 (D8): the refusals and the rollback of delivering an app fix. The
// happy path and the scenarios are in scenarios/trusted-runtime-packages.test.ts.
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, vi } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { appPathsFromEnvironment, deliveredOver, deliverApp, deliveryKeyMatches } from '../src/app-delivery'
import { loadInstalledApps } from '../src/apps'
import { sql } from '../src/db'
import { app } from '../src/index'
import { discoverPackages, shippedDigest } from '../src/runtime-packages'
import { expectStatus } from './fixtures'

const OTHER = resolve(import.meta.dirname, '../../../test-apps/other')
const KEY = 'a-long-random-deploy-key-for-tests-only-0123456789'

async function filesOf(folder: string, under = ''): Promise<{ path: string; data: string }[]> {
  const out: { path: string; data: string }[] = []
  for (const entry of await readdir(join(folder, under), { withFileTypes: true })) {
    const path = under ? `${under}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...await filesOf(folder, path))
    else out.push({ path, data: (await readFile(join(folder, path))).toString('base64') })
  }
  return out
}

async function installed(admin: TestClient) {
  const image = await mkdtemp(resolve('test/.delivery-image-'))
  const storage = await mkdtemp(resolve('test/.delivery-volume-'))
  await cp(OTHER, image, { recursive: true })
  vi.stubEnv('FEATHERBASE_APP_PATHS', JSON.stringify([image]))
  vi.stubEnv('FILE_STORAGE_DIR', storage)
  await discoverPackages([image])
  await admin.post('/api/install_app', { name: 'other' })
  const copy = async (change: (folder: string) => Promise<void>) => {
    const folder = await mkdtemp(resolve('test/.delivery-copy-'))
    await cp(image, folder, { recursive: true })
    await change(folder)
    return folder
  }
  const cleanup = async () => {
    vi.unstubAllEnvs()
    for (const folder of await readdir(resolve('test'))) if (folder.startsWith('.delivery-')) await rm(resolve('test', folder), { recursive: true, force: true })
    await discoverPackages([])
    await loadInstalledApps()
  }
  return { image, storage, copy, cleanup }
}
const retitle = (title: string) => async (folder: string) => {
  const html = await readFile(join(folder, 'client/index.html'), 'utf8')
  await writeFile(join(folder, 'client/index.html'), html.replace(/<h1>[^<]*<\/h1>/, `<h1>${title}</h1>`))
}
const page = async (admin: TestClient) => (await admin.fetch('/other/', { headers: { accept: 'text/html' } })).text()

describe('the deploy key', () => {
  test('is off without a key, with a short key, or without a Bearer header', () => {
    expect(deliveryKeyMatches(`Bearer ${KEY}`)).toBe(false)
    vi.stubEnv('APP_DELIVERY_TOKEN', 'too-short')
    expect(deliveryKeyMatches('Bearer too-short')).toBe(false)
    vi.stubEnv('APP_DELIVERY_TOKEN', KEY)
    expect(deliveryKeyMatches(KEY)).toBe(false)
    expect(deliveryKeyMatches(undefined)).toBe(false)
    expect(deliveryKeyMatches(`Bearer ${KEY}`)).toBe(true)
    vi.unstubAllEnvs()
  })

  test('a body over the size limit is refused before it is read', async () => {
    vi.stubEnv('APP_DELIVERY_TOKEN', KEY)
    try {
      const res = await app.request('/deliver/app', { method: 'POST', body: '{}',
        headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json', 'content-length': String(100 * 1024 * 1024) } })
      await expectStatus(res, 417)
      const notJson = await app.request('/deliver/app', { method: 'POST', body: 'not json',
        headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' } })
      await expectStatus(notJson, 417)
    } finally { vi.unstubAllEnvs() }
  })
})

describe('a delivery is refused, changing nothing', () => {
  test('without a volume, or without files', async () => {
    vi.stubEnv('FILE_STORAGE_DIR', '')
    await expect(deliverApp({ files: [] })).rejects.toThrow(/needs FILE_STORAGE_DIR/)
    expect(appPathsFromEnvironment()).toEqual([])
    expect(await deliveredOver(OTHER)).toBeNull()
    vi.stubEnv('FILE_STORAGE_DIR', resolve('test/.delivery-none'))
    await expect(deliverApp(null)).rejects.toThrow(/Expected \{ files/)
    await expect(deliverApp({ files: [] })).rejects.toThrow(/Expected \{ files/)
    vi.unstubAllEnvs()
  })

  test('with a path that leaves the app folder, or one that is not relative', async () => {
    vi.stubEnv('FILE_STORAGE_DIR', resolve('test/.delivery-none'))
    for (const path of ['../escape.js', '/etc/passwd', 'dist\\x.js', 'node_modules/x.js', '', 7])
      await expect(deliverApp({ files: [{ path, data: '' }] })).rejects.toThrow(/relative path|may not leave/)
    vi.unstubAllEnvs()
  })

  test('over 50 MB, or when the files are not an app', async ({ admin }) => {
    const run = await installed(admin)
    try {
      await expect(deliverApp({ files: [{ path: 'big.bin', data: Buffer.alloc(51 * 1024 * 1024).toString('base64') }] })).rejects.toThrow(/at most 50 MB/)
      await expect(deliverApp({ files: [{ path: 'notes.txt', data: Buffer.from('hi').toString('base64') }, { path: 'empty.txt' }] })).rejects.toThrow(/not an app/)
      expect(await shippedDigest([run.image], 'other', '9.9.9')).toBe('')
      expect(await readdir(join(run.storage, 'delivered-apps'))).toEqual([])
    } finally { await run.cleanup() }
  })

  test('for another version than the one installed', async ({ admin }) => {
    const run = await installed(admin)
    try {
      const next = await run.copy(async (folder) => {
        const pkg = JSON.parse(await readFile(join(folder, 'package.json'), 'utf8'))
        await writeFile(join(folder, 'package.json'), JSON.stringify({ ...pkg, version: '9.9.9' }))
      })
      await expect(deliverApp({ files: await filesOf(next) })).rejects.toThrow(/9\.9\.9 is not it/)
    } finally { await run.cleanup() }
  })
})

describe('a delivery that fails to load', () => {
  test('puts back the copy delivered before it, and the page keeps serving that copy', async ({ admin }) => {
    const run = await installed(admin)
    try {
      const first = await run.copy(retitle('First fix'))
      expect(await deliverApp({ files: await filesOf(first) })).toMatchObject({ outcome: 'repinned' })
      expect(await deliverApp({ files: await filesOf(first) })).toMatchObject({ outcome: 'same' })
      const before = await readFile(join(run.storage, 'delivered-apps', 'other.over'), 'utf8')
      // Same declaration, but its server module cannot load: the swapped-in copy is not taken.
      const broken = await run.copy(async (folder) => { await writeFile(join(folder, 'server.mjs'), 'export const = broken') })
      await expect(deliverApp({ files: await filesOf(broken) })).rejects.toThrow(/could not be loaded/)
      expect(await page(admin)).toContain('<h1>First fix</h1>')
      expect(await readFile(join(run.storage, 'delivered-apps', 'other.over'), 'utf8')).toBe(before)
      expect((await readdir(join(run.storage, 'delivered-apps'))).sort()).toEqual(['other', 'other.over'])
    } finally { await run.cleanup() }
  })

  test('with nothing delivered before it leaves the image copy serving', async ({ admin }) => {
    const run = await installed(admin)
    try {
      const broken = await run.copy(async (folder) => { await writeFile(join(folder, 'server.mjs'), 'export const = broken') })
      await expect(deliverApp({ files: await filesOf(broken) })).rejects.toThrow(/could not be loaded/)
      expect(await readdir(join(run.storage, 'delivered-apps'))).toEqual([])
      expect(await sql`select package_version from installed_app where name = 'other'`).toEqual([{ package_version: '0.0.1' }])
    } finally { await run.cleanup() }
  })

  test('a delivered folder without its record of the image copy loses to the image copy', async ({ admin }) => {
    const run = await installed(admin)
    try {
      const first = await run.copy(retitle('First fix'))
      await deliverApp({ files: await filesOf(first) })
      await rm(join(run.storage, 'delivered-apps', 'other.over'))
      expect(await deliveredOver(join(run.storage, 'delivered-apps', 'other'))).toBe('')
      expect(await deliveredOver(run.image)).toBeNull()
    } finally { await run.cleanup() }
  })
})
