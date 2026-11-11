// A person-scoped read decides its places, then the versions any dropped
// place is recorded against. A scope provider turned off between the two
// leaves no versions to record against; the read still answers with the
// places it was authorized for. The window is held open with a module mock:
// the provider is switched off inside readyAppSetup, which runs between them.
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { makeClient, type CreateUserFn, type TestClient } from 'feather-testing-postgres'
import { expect, vi } from 'vitest'
import { test as pgTest } from './pg-test'
import { sql } from '../src/db'
import { availableRuntimeVersions, discoverPackages } from '../src/runtime-packages'

const window = vi.hoisted(() => ({ turnOff: false }))

vi.mock('../src/app-settings', async (original) => {
  const actual = await original<typeof import('../src/app-settings')>()
  return { ...actual, readyAppSetup: async (...args: Parameters<typeof actual.readyAppSetup>) => {
    if (window.turnOff) {
      window.turnOff = false
      await sql`update installed_app set enabled = false where name = 'placeroster'`
    }
    return actual.readyAppSetup(...args)
  } }
})

const fixture = resolve('../..', 'test-apps/fixtures/dataset-proof')
const provider = resolve('../..', 'test-apps/fixtures/place-roster')
const pinned = (client: TestClient) => makeClient({ request: (path, init) => client.fetch(String(path), {
  ...init, headers: { 'X-Featherbase-App-Version': 'datasetproof@1.0.0', ...init?.headers },
}) }, client.token, client.user)
const test = pgTest.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(pinned(admin)),
  createUser: async ({ createUser }, use) => use(async options => pinned(await createUser(options))),
})

test('a read whose scope provider is turned off after its places were decided still answers', async ({ admin, createUser }) => {
  expect(await discoverPackages([fixture, provider])).toEqual([])
  await admin.post('/api/install_app', { name: 'datasetproof' })
  await admin.post('/api/install_app', { name: 'placeroster' })
  const reader = await createUser({ email: 'reader-off@example.test', roles: ['Dataset Reader'] })
  const digest = availableRuntimeVersions().find(p => p.name === 'placeroster')!.digest
  const roster = await import(`${pathToFileURL(resolve(provider, 'server.mjs')).href}?artifact=${digest}`)
  roster.faults.result = [{ label: 'South', filters: { store: ['S1'] } }]
  try {
    window.turnOff = true
    expect(await reader.post('/api/app_reads/datasetproof/inside', { payload: {} })).toEqual({ result: null })
    expect(window.turnOff).toBe(false)
  } finally {
    delete roster.faults.result
    window.turnOff = false
  }
})
