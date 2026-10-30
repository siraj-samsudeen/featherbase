// #642 (design E8): an app declares controls for the shared top bar. The
// platform draws them; it fills a picker from the app's own read, under the
// reader's scope, and the choice goes into the address. Fixtures:
// test-apps/fixtures/bar-proof declares a store picker,
// test-apps/fixtures/place-roster provides people's scope.
import { afterEach, describe, expect } from 'vitest'
import { resolve } from 'node:path'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { availableRuntimeVersions, discoverPackages } from '../src/runtime-packages'
import { pathToFileURL } from 'node:url'
import { sql } from '../src/db'

const BAR_PROOF = resolve('../..', 'test-apps/fixtures/bar-proof')
const ROSTER = resolve('../..', 'test-apps/fixtures/place-roster')

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

/** A copy of the bar-proof fixture, its manifest changed by `change`. */
async function barProof(change: (manifest: Record<string, unknown>) => Record<string, unknown>) {
  const directory = await mkdtemp(resolve('test/.b5-642-bar-'))
  directories.push(directory)
  await cp(BAR_PROOF, directory, { recursive: true })
  const file = resolve(directory, 'featherbase.json')
  await writeFile(file, JSON.stringify(change(JSON.parse(await readFile(file, 'utf8')))))
  return directory
}

describe('declared bar controls: discovery', () => {
  test("a picker filled from one of the app's reads is accepted", async () => {
    expect(await discoverPackages([BAR_PROOF])).toEqual([])
  })

  test("a picker filled from anything but one of the app's reads is refused", async () => {
    const directory = await barProof((manifest) => ({ ...manifest, bar: [{ picker: 'Store', options: 'store_list', sets: 'store' }] }))
    expect(await discoverPackages([directory])).toEqual([
      expect.objectContaining({ error: "The bar's Store picker is filled from store_list, which is not one of the app's reads" }),
    ])
  })

  test.for(['', 'store id', 'store=12', 'Store', '1store', 'store&x'])('a picker setting %j is refused', async (sets) => {
    const directory = await barProof((manifest) => ({ ...manifest, bar: [{ picker: 'Store', options: 'stores', sets }] }))
    expect(await discoverPackages([directory])).toEqual([
      expect.objectContaining({ error: expect.stringContaining('A bar control sets a query-string key: lower case letters, digits and _, starting with a letter') }),
    ])
  })

  test('two controls setting the same key are refused', async () => {
    const directory = await barProof((manifest) => ({ ...manifest, bar: [
      { picker: 'Store', options: 'stores', sets: 'store' },
      { picker: 'Branch', options: 'stores', sets: 'store' },
    ] }))
    expect(await discoverPackages([directory])).toEqual([
      expect.objectContaining({ error: 'Two bar controls set store; each sets its own key' }),
    ])
  })
})

describe("declared bar controls: the picker's options", () => {
  async function installed(admin: TestClient, createUser: CreateUserFn, roles = ['Bar Reader']) {
    expect(await discoverPackages([BAR_PROOF, ROSTER])).toEqual([])
    await admin.post('/api/install_app', { name: 'barproof' })
    await admin.post('/api/install_app', { name: 'placeroster' })
    return createUser({ email: 'bar-manager@example.test', roles })
  }
  const position = (admin: TestClient, person: string, place: string, store: string) =>
    admin.post('/api/save_row', { table: 'placeroster.position', row: { row_id: `${person}-${store}`, person, place, store, section: 'all' } })

  test('a manager responsible for two stores is offered exactly those two, in the order the read gives them', async ({ admin, createUser }) => {
    const manager = await installed(admin, createUser)
    await position(admin, manager.user!, 'North', 'N1')
    await position(admin, manager.user!, 'South', 'S1')
    await position(admin, 'someone-else', 'East', 'E1')
    expect(await manager.get('/api/app_bar/barproof')).toEqual({ controls: [{
      picker: 'Store', sets: 'store', options: [{ value: 'N1', label: 'North' }, { value: 'S1', label: 'South' }],
    }] })
  })

  test('a person the read refuses is offered nothing, and the refusal is logged', async ({ admin, createUser }) => {
    const unplaced = await installed(admin, createUser)
    expect(await unplaced.get('/api/app_bar/barproof')).toEqual({ controls: [{ picker: 'Store', sets: 'store', options: [] }] })
    expect(await sql`select method from access_log where "user" = ${unplaced.user!} and operation = 'app_access_denied'`)
      .toEqual([{ method: 'barproof.stores:scope' }])
  })

  test('a read that answers anything but a list of values and labels is refused, naming the app and read', async ({ admin, createUser }) => {
    const directory = await barProof((manifest) => ({ ...manifest, bar: [{ picker: 'Store', options: 'malformed', sets: 'store' }] }))
    expect(await discoverPackages([directory, ROSTER])).toEqual([])
    await admin.post('/api/install_app', { name: 'barproof' })
    await expect(admin.get('/api/app_bar/barproof')).rejects.toMatchObject({ status: 500,
      message: expect.stringContaining("App barproof's read malformed answered options the bar cannot show: it must answer a list of { value, label }") })
  })

  // Codex round 1 on #643: an outbound options read calls out after its
  // authorization, holding no lifecycle lock, as an app read does (#625).
  test('while an outbound options read waits on an outside call, an app lifecycle change completes', async ({ admin }) => {
    const directory = await barProof((manifest) => ({ ...manifest, bar: [{ picker: 'Store', options: 'waiting', sets: 'store' }] }))
    expect(await discoverPackages([directory, ROSTER])).toEqual([])
    await admin.post('/api/install_app', { name: 'barproof' })
    await admin.post('/api/install_app', { name: 'placeroster' })
    const digest = availableRuntimeVersions().find((p) => p.name === 'barproof')!.digest
    const app = await import(`${pathToFileURL(resolve(directory, 'server.mjs')).href}?artifact=${digest}`)
    let entered!: () => void
    let release!: () => void
    const inside = new Promise<void>((done) => { entered = done })
    const gate = new Promise<void>((done) => { release = done })
    app.hooks.wait = async () => { entered(); await gate }
    const pending = admin.get('/api/app_bar/barproof')
    const changed = inside.then(() => admin.post('/api/set_app_enabled', { name: 'placeroster', enabled: true }))
    try {
      await inside
      await Promise.race([changed, new Promise((_, reject) => setTimeout(() => reject(new Error('blocked: still waiting')), 3000))])
    } finally {
      release()
      // Every request this test started finishes inside its sandbox.
      await Promise.allSettled([pending, changed])
    }
    expect(await pending).toEqual({ controls: [{ picker: 'Store', sets: 'store', options: [{ value: 'N1', label: 'North' }] }] })
  })

  test('an app that declared no bar controls has none', async ({ admin }) => {
    expect(await discoverPackages([resolve('../..', 'test-apps/other')])).toEqual([])
    await admin.post('/api/install_app', { name: 'other' })
    expect(await admin.get('/api/app_bar/other')).toEqual({ controls: [] })
  })

  test('a read that fails for any other reason fails the request', async ({ admin }) => {
    const directory = await barProof((manifest) => ({ ...manifest, bar: [{ picker: 'Store', options: 'broken', sets: 'store' }] }))
    expect(await discoverPackages([directory, ROSTER])).toEqual([])
    await admin.post('/api/install_app', { name: 'barproof' })
    await expect(admin.get('/api/app_bar/barproof')).rejects.toMatchObject({ status: 500 })
  })

  test.for(['a disabled app', 'an app that is not installed'])('%s is unavailable', async (which, { admin, createUser }) => {
    const manager = await installed(admin, createUser)
    if (which === 'a disabled app') await admin.post('/api/set_app_enabled', { name: 'barproof', enabled: false })
    const name = which === 'a disabled app' ? 'barproof' : 'nosuchapp'
    await expect(manager.get(`/api/app_bar/${name}`)).rejects.toMatchObject({ status: 404, message: expect.stringContaining('App is unavailable') })
  })
})
