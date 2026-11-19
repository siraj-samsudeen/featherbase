// #1328 (audit F09): an address the server cannot open as an app is sent to the
// shared page, which repeats the address as text only. That an app is turned off
// is said only to someone who could use it; signed out, or without access, nothing
// is available there, so no one learns which apps exist. Made-up people.
import { describe, expect } from 'vitest'
import { resolve } from 'node:path'
import { askedAddress, unavailableHref } from 'shared'
import { test } from './pg-test'
import { discoverPackages } from '../src/runtime-packages'
import { expectStatus } from './fixtures'
import type { TestClient } from 'feather-testing-postgres'

const BAR_PROOF = resolve('../..', 'test-apps/fixtures/bar-proof')
const page = (client: TestClient, path: string) => client.fetch(path, { headers: { accept: 'text/html' }, redirect: 'manual' })
const status = async (client: TestClient, address: string) =>
  (await client.get<{ turned_off: { title: string } | null }>(`/api/address_status?address=${encodeURIComponent(address)}`)).turned_off

async function installBarProof(admin: TestClient) {
  expect(await discoverPackages([BAR_PROOF])).toEqual([])
  await admin.post('/api/install_app', { name: 'barproof' })
}

describe('#1328: an address the server cannot open goes to the shared page', () => {
  test('signed in, a root that is no app goes there, with the address it asked for', async ({ admin }) => {
    const res = await page(admin, '/equipment/')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(unavailableHref('/equipment/'))
  })

  test('signed out, it goes there too, never to sign-in; an app that is on still goes to sign-in', async ({ api, admin }) => {
    await installBarProof(admin)
    const missing = await page(api, '/equipment/')
    expect(missing.headers.get('location')).toBe(unavailableHref('/equipment/'))
    const on = await page(api, '/barproof/')
    expect(on.headers.get('location')).toBe(`/featherbase/login?next=${encodeURIComponent('/barproof/')}`)
    // Turned off, it reads exactly as one that does not exist.
    await admin.post('/api/set_app_enabled', { name: 'barproof', enabled: false })
    expect((await page(api, '/barproof/')).headers.get('location')).toBe(unavailableHref('/barproof/'))
  })
})

describe('#1328: whether an app is turned off is said only to someone who could use it', () => {
  test('an administrator, and a person with its role, are told; anyone else is told nothing', async ({ admin, createUser }) => {
    await installBarProof(admin)
    await admin.post('/api/set_app_enabled', { name: 'barproof', enabled: false })
    const reader = await createUser({ email: 'ua-reader@example.test', roles: ['Bar Reader'] })
    const stranger = await createUser({ email: 'ua-stranger@example.test', roles: [] })
    expect(await status(admin, '/barproof/')).toEqual({ title: 'Bar proof' })
    expect(await status(reader, '/barproof/somewhere')).toEqual({ title: 'Bar proof' })
    expect(await status(stranger, '/barproof/')).toBeNull()
    // An app that is on, or not installed, is nothing to say "turned off" about.
    await admin.post('/api/set_app_enabled', { name: 'barproof', enabled: true })
    expect(await status(admin, '/barproof/')).toBeNull()
    expect(await status(admin, '/equipment/')).toBeNull()
  })

  test('only a plain address is answered about, and only to someone signed in', async ({ api, admin }) => {
    await installBarProof(admin)
    await admin.post('/api/set_app_enabled', { name: 'barproof', enabled: false })
    for (const address of ['//barproof/', 'https://barproof/', '/\\barproof/', 'barproof/'])
      expect(await status(admin, address), address).toBeNull()
    await expectStatus(await api.fetch('/api/address_status?address=%2Fbarproof%2F'), 401)
  })
})

describe('#1328: the address the page may repeat', () => {
  test('a relative path with a single leading slash, no backslash or control character, at most 200 long', () => {
    expect(askedAddress('/equipment/')).toBe('/equipment/')
    for (const bad of ['//evil.example', 'https://evil.example', '/\\evil', 'evil', '/a\nb', `/${'x'.repeat(200)}`, 42, null])
      expect(askedAddress(bad), String(bad)).toBeNull()
  })
})
