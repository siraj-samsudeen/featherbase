// #659 (owner decision, 28-Oct-2026): an installed app's own Tables do not
// count towards "can use Admin". Every app's readers must read its entry Table
// for the app to open, so counting it handed every reader of an app the Admin.
// Their grants still reach the app's Tables through the app; only the Admin
// screens, and the endpoints that lead into them, refuse them.
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { config } from '../src/config'
import { discoverPackages } from '../src/runtime-packages'
import { landingAfterSignIn } from '../src/landing'

type Caps = { manage: boolean; admin: boolean; own_grant: boolean; tables: string[] }
type CreateUser = (opts: { email?: string; roles?: string[] }) => Promise<TestClient & { user: string }>

const DASH_STAND_IN = resolve('../..', 'runtime-apps/fixtures/dash-stand-in')
const APP_TABLE = 'feather_dash.note'
const ROLE = 'Dash Reader'

const capsOf = async (client: TestClient) => (await client.get<{ capabilities: Caps }>('/api/whoami')).capabilities

/** Feather Dash (the stand-in) installed, and a role granted read on its
 *  entry Table: the grant every Feather Dash role holds. */
async function installAppWithReaderRole(admin: TestClient) {
  expect(await discoverPackages([DASH_STAND_IN])).toEqual([])
  await admin.post('/api/install_app', { name: 'feather_dash' })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: ROLE } })
  await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: APP_TABLE, role: ROLE, can_read: true } })
}

/** A Table of the instance's own, with a role that reads it. */
async function instanceTableWithRole(admin: TestClient, role: string) {
  await admin.post('/api/table_def', { name: 'Back Office', columns: [{ column_name: 'title', column_type: 'Data', label: 'Title' }] })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: role } })
  await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Back Office', role, can_read: true } })
}

beforeEach(() => {
  config.instanceAddresses = null
})

// The installed app stays loaded in this process after its rows roll back.
afterEach(async () => {
  await discoverPackages([])
})

describe("a person whose only grant is on an installed app's Table", () => {
  async function appReader(admin: TestClient, createUser: CreateUser, email: string) {
    await installAppWithReaderRole(admin)
    return createUser({ email, roles: [ROLE] })
  }

  test('whoami says they cannot use Admin', async ({ admin, createUser }) => {
    const reader = await appReader(admin, createUser, 'app.only.whoami@example.com')
    expect((await capsOf(reader)).admin).toBe(false)
  })

  test('opening the Admin is refused', async ({ admin, createUser }) => {
    const reader = await appReader(admin, createUser, 'app.only.open@example.com')
    await expect(reader.post('/api/open_admin', {})).rejects.toMatchObject({ status: 403 })
  })

  test('signing in lands them in the app, not the Admin', async ({ admin, createUser }) => {
    const reader = await appReader(admin, createUser, 'app.only.landing@example.com')
    expect(await landingAfterSignIn({ token: 'unused', user: { row_id: reader.user } as never }, 'localhost')).toEqual({
      landing: '/feather_dash/',
    })
  })

  test('the app still opens for them', async ({ admin, createUser }) => {
    const reader = await appReader(admin, createUser, 'app.only.opens@example.com')
    expect((await reader.get<{ apps: { name: string }[] }>('/api/whoami')).apps.map((a) => a.name)).toEqual(['feather_dash'])
  })

  test("the app's Table still reads for them", async ({ admin, createUser }) => {
    const reader = await appReader(admin, createUser, 'app.only.reads@example.com')
    await admin.post('/api/save_row', { table: APP_TABLE, row: { row_id: 'n-1', body: 'hello' } })
    const list = await reader.get<{ data: { row_id: string }[] }>(`/api/table/${encodeURIComponent(APP_TABLE)}`)
    expect(list.data.map((r) => r.row_id)).toEqual(['n-1'])
  })

  test('a row of the app shared with them does not open the Admin either', async ({ admin, createUser }) => {
    await installAppWithReaderRole(admin)
    await admin.post('/api/save_row', { table: APP_TABLE, row: { row_id: 'n-2', body: 'shared' } })
    const guest = await createUser({ email: 'app.share@example.com' })
    await admin.post('/api/save_row', { table: 'Share', row: { share_table: APP_TABLE, share_name: 'n-2', person: guest.user, read: true } })
    expect((await capsOf(guest)).admin).toBe(false)
  })
})

describe('grants outside installed apps count as before', () => {
  test('a person with a grant on an instance Table can use Admin', async ({ admin, createUser }) => {
    await installAppWithReaderRole(admin)
    await instanceTableWithRole(admin, 'Office Clerk')
    const clerk = await createUser({ email: 'office.clerk@example.com', roles: ['Office Clerk'] })
    expect((await capsOf(clerk)).admin).toBe(true)
  })

  test("a person with both grants uses Admin, listing the app's Table too", async ({ admin, createUser }) => {
    await installAppWithReaderRole(admin)
    await instanceTableWithRole(admin, 'Office Clerk')
    const both = await createUser({ email: 'both.grants@example.com', roles: [ROLE, 'Office Clerk'] })
    expect(await capsOf(both)).toMatchObject({ admin: true, own_grant: true, tables: ['Back Office', APP_TABLE] })
  })

  test("an app's Table grant is not a grant of their own beside a shared instance row", async ({ admin, createUser }) => {
    await installAppWithReaderRole(admin)
    await admin.post('/api/table_def', { name: 'Back Office', columns: [{ column_name: 'title', column_type: 'Data', label: 'Title' }] })
    const row = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Back Office', row: { title: 'Shared' } })
    const reader = await createUser({ email: 'app.and.share@example.com', roles: [ROLE] })
    await admin.post('/api/save_row', { table: 'Share', row: { share_table: 'Back Office', share_name: row.row_id, person: reader.user, read: true } })
    expect(await capsOf(reader)).toMatchObject({ admin: true, own_grant: false })
  })

  test('a System Manager can use Admin', async ({ admin, createUser }) => {
    await installAppWithReaderRole(admin)
    const manager = await createUser({ email: 'manager.659@example.com', roles: ['System Manager', ROLE] })
    expect(await capsOf(manager)).toMatchObject({ manage: true, admin: true })
  })
})

test("a disabled app's Tables still do not count towards Admin", async ({ admin, createUser }) => {
  await installAppWithReaderRole(admin)
  await admin.post('/api/set_app_enabled', { name: 'feather_dash', enabled: false })
  const reader = await createUser({ email: 'disabled.app.reader@example.com', roles: [ROLE] })
  expect((await capsOf(reader)).admin).toBe(false)
})
