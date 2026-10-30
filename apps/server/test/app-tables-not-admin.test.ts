// #659 (owner decision, 28-Oct-2026): an installed app's own Tables do not
// count towards "can use Admin". Every app's readers must read its entry Table
// for the app to open, so counting it handed every reader of an app the Admin.
// Their grants still reach the app's Tables through the app; only the Admin
// screens, and the endpoints that lead into them, refuse them.
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect } from 'vitest'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { config } from '../src/config'
import { parseInstanceAddresses } from '../src/instance-addresses'
import { discoverPackages } from '../src/runtime-packages'
import { landingAfterSignIn } from '../src/landing'
import { sql } from '../src/db'

type Caps = { manage: boolean; admin: boolean; own_grant: boolean; tables: string[] }

const DASH_STAND_IN = resolve('../..', 'test-apps/fixtures/dash-stand-in')
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
  async function appReader(admin: TestClient, createUser: CreateUserFn, email: string) {
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
    // Glossary Term: everyone signed in reads the glossary (#629).
    expect(await capsOf(both)).toMatchObject({ admin: true, own_grant: true, tables: ['Back Office', 'Glossary Term', APP_TABLE] })
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

// Codex round 1 on #675: once an app's readers cannot use Admin, a sign-in
// that would have landed them in the Admin must land them in an app they can
// open, chosen from the app catalog, never by an app's name in platform code.
describe('signing in, a person who cannot use Admin lands in an app they can open', () => {
  const BAR_PROOF = resolve('../..', 'test-apps/fixtures/bar-proof')
  const ROSTER = resolve('../..', 'test-apps/fixtures/place-roster')
  const OTHER = resolve('../..', 'test-apps/other')
  const ADMIN_AT = 'https://admin.example.com'
  const landingOf = (person: string | null, host: string) => landingAfterSignIn({ token: 'unused', user: { row_id: person! } as never }, host)

  async function install(admin: TestClient, ...names: string[]) {
    expect(await discoverPackages([BAR_PROOF, ROSTER, OTHER])).toEqual([])
    for (const name of names) await admin.post('/api/install_app', { name })
  }

  test('a reader of one app only lands on that app on a host the list does not name', async ({ admin, createUser }) => {
    await install(admin, 'barproof')
    const reader = await createUser({ email: 'bar.only.landing@example.com', roles: ['Bar Reader'] })
    expect(await landingOf(reader.user, 'localhost')).toEqual({ landing: '/barproof/' })
  })

  test('a reader of several apps lands on the first by title', async ({ admin, createUser }) => {
    // Installed in the other order, so the catalog's own order would pick Other tasks.
    await install(admin, 'other', 'barproof')
    // Other tasks is open to everyone (All); a role of their own opens it to them too.
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Other Reader' } })
    await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'other.task', role: 'Other Reader', can_read: true } })
    const reader = await createUser({ email: 'two.apps.landing@example.com', roles: ['Bar Reader', 'Other Reader'] })
    expect(await landingOf(reader.user, 'localhost')).toEqual({ landing: '/barproof/' })
  })

  test("on the Admin address, a reader of an app that has no address of its own lands on that app's root there", async ({ admin, createUser }) => {
    await install(admin, 'barproof')
    config.instanceAddresses = parseInstanceAddresses(JSON.stringify([{ address: ADMIN_AT, opens: 'admin', emails: true }]), 'test')
    const reader = await createUser({ email: 'bar.admin.address@example.com', roles: ['Bar Reader'] })
    expect(await landingOf(reader.user, 'admin.example.com')).toEqual({ landing: '/barproof/' })
  })

  test("the app the address opens wins over the first by title", async ({ admin, createUser }) => {
    await install(admin, 'other', 'barproof')
    config.instanceAddresses = parseInstanceAddresses(
      JSON.stringify([{ address: 'https://other.example.com', opens: 'other', emails: true }, { address: ADMIN_AT, opens: 'admin' }]),
      'test',
    )
    const reader = await createUser({ email: 'address.app.wins@example.com', roles: ['Bar Reader'] })
    expect(await landingOf(reader.user, 'other.example.com')).toEqual({ landing: '/other/' })
  })

  test('a person who can open no app is left to the no-access page', async ({ admin, createUser }) => {
    await install(admin, 'barproof')
    const nobody = await createUser({ email: 'opens.nothing@example.com' })
    expect(await landingOf(nobody.user, 'localhost')).toEqual({})
  })

  // CI e2e at 2b1335cc: an app open to everyone (All) is no one's in
  // particular, so it never claims a new person who has no role of use.
  test('a person with no role of their own is left to the no-access page, though an app is open to everyone', async ({ admin, createUser }) => {
    await install(admin, 'other')
    const newcomer = await createUser({ email: 'newcomer.all.app@example.com' })
    expect(await landingOf(newcomer.user, 'localhost')).toEqual({})
  })

  test('a reader whose own role opens an app lands on it, past an app open to everyone', async ({ admin, createUser }) => {
    await install(admin, 'other', 'barproof')
    const reader = await createUser({ email: 'own.role.past.all@example.com', roles: ['Bar Reader'] })
    expect(await landingOf(reader.user, 'localhost')).toEqual({ landing: '/barproof/' })
  })

  test("the address's own app still opens to everyone it is open to", async ({ admin, createUser }) => {
    await install(admin, 'other')
    config.instanceAddresses = parseInstanceAddresses(
      JSON.stringify([{ address: 'https://other.example.com', opens: 'other', emails: true }, { address: ADMIN_AT, opens: 'admin' }]),
      'test',
    )
    const newcomer = await createUser({ email: 'newcomer.on.app.address@example.com' })
    expect(await landingOf(newcomer.user, 'other.example.com')).toEqual({ landing: '/other/' })
  })
})

// Codex round 1 on #675 (decision, 28-Oct-2026, provisional): only an app that
// opens at its own root (the app catalog's test) takes its Tables out of the
// Admin. An app without pages of its own is used through the Admin's generated
// lists and forms, so its readers keep the Admin.
describe('an app without pages of its own', () => {
  const EVOLVE = resolve('../..', 'test-apps/fixtures/evolve-v1')

  async function evolveClerk(admin: TestClient, createUser: CreateUserFn) {
    expect(await discoverPackages([EVOLVE])).toEqual([])
    await admin.post('/api/install_app', { name: 'evolve' })
    return createUser({ email: 'evolve.clerk.659@example.com', roles: ['Evolve Clerk'] })
  }

  test("its reader can still use Admin", async ({ admin, createUser }) => {
    const clerk = await evolveClerk(admin, createUser)
    expect((await capsOf(clerk)).admin).toBe(true)
  })

  test("its reader can still add a row through the Admin's generated form", async ({ admin, createUser }) => {
    const clerk = await evolveClerk(admin, createUser)
    const saved = await clerk.post<{ row_id: string }>('/api/save_row', { table: 'evolve.item', row: { row_id: 'it-1', title: 'Shelf' } })
    expect(saved.row_id).toBe('it-1')
  })
})

// Codex round 1 on #675: the installed-app ledger may hold its Tables as a
// JSON string of an array (installed-app-ledger.ts reads both shapes).
describe('an app whose ledger holds its Tables as a JSON string', () => {
  const doubleEncode = () => sql`update installed_app set tables = to_jsonb(tables::text) where name = 'feather_dash'`

  test("a grant on its Table still does not open the Admin", async ({ admin, createUser }) => {
    await installAppWithReaderRole(admin)
    await doubleEncode()
    const reader = await createUser({ email: 'ledger.grant@example.com', roles: [ROLE] })
    expect((await capsOf(reader)).admin).toBe(false)
  })

  test("a shared row of its Table still does not open the Admin", async ({ admin, createUser }) => {
    await installAppWithReaderRole(admin)
    await admin.post('/api/save_row', { table: APP_TABLE, row: { row_id: 'n-3', body: 'shared' } })
    await doubleEncode()
    const guest = await createUser({ email: 'ledger.share@example.com' })
    await admin.post('/api/save_row', { table: 'Share', row: { share_table: APP_TABLE, share_name: 'n-3', person: guest.user, read: true } })
    expect((await capsOf(guest)).admin).toBe(false)
  })
})

// Codex round 2 on #675 (standard P2, adversarial high): whether an app has
// pages of its own is what its installation declared, never whether this
// process managed to load its files. An artifact missing or rejected at a
// restart must not hand its Tables back to the Admin: that would fail open.
describe("a client app whose artifact is not loaded after a restart", () => {
  const restarts = {
    'missing': async () => {
      await discoverPackages([])
    },
    'rejected (another fingerprint)': async () => {
      await sql`update installed_app set artifact_digest = 'another-artifact' where name = 'feather_dash'`
      await discoverPackages([DASH_STAND_IN])
    },
  }
  /** Who could fail open: a manual grant on the app's Table to an instance
   *  role (`owner_app` null), or a row of it shared with them. */
  const holders = {
    'a manual grant on its Table': async (_admin: TestClient, createUser: CreateUserFn, email: string) =>
      createUser({ email, roles: [ROLE] }),
    'a row of its Table shared with them': async (admin: TestClient, createUser: CreateUserFn, email: string) => {
      const row = await admin.post<{ row_id: string }>('/api/save_row', { table: APP_TABLE, row: { row_id: `row-${email}`, body: 'shared' } })
      const guest = await createUser({ email })
      await admin.post('/api/save_row', { table: 'Share', row: { share_table: APP_TABLE, share_name: row.row_id, person: guest.user, read: true } })
      return guest
    },
  }

  let n = 0
  for (const [artifact, restart] of Object.entries(restarts))
    for (const [holding, holder] of Object.entries(holders)) {
      const email = `artifact.${++n}.659@example.com`
      test(`artifact ${artifact}, ${holding}: whoami says no Admin`, async ({ admin, createUser }) => {
        await installAppWithReaderRole(admin)
        const person = await holder(admin, createUser, email)
        await restart()
        expect((await capsOf(person)).admin).toBe(false)
      })

      test(`artifact ${artifact}, ${holding}: opening the Admin is refused`, async ({ admin, createUser }) => {
        await installAppWithReaderRole(admin)
        const person = await holder(admin, createUser, email)
        await restart()
        await expect(person.post('/api/open_admin', {})).rejects.toMatchObject({ status: 403 })
      })
    }

  test.for([null, '{invalid', JSON.stringify({ client: { entry: 'index.html' } })])("an installation whose own-pages declaration is stored as %j never exposes ordinary Tables", async (manifest, { admin, createUser }) => {
    await installAppWithReaderRole(admin)
    await sql`update installed_app set manifest = ${manifest === null ? null : sql.json(manifest)} where name = 'feather_dash'`
    const reader = await createUser({ email: 'unreadable.manifest.659@example.com', roles: [ROLE] })
    expect((await capsOf(reader)).admin).toBe(false)
  })

  test("an instance grant on a Table of an app without pages of its own still opens the Admin", async ({ admin, createUser }) => {
    expect(await discoverPackages([resolve('../..', 'test-apps/fixtures/evolve-v1')])).toEqual([])
    await admin.post('/api/install_app', { name: 'evolve' })
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Evolve Helper' } })
    await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'evolve.item', role: 'Evolve Helper', can_read: true } })
    await discoverPackages([])
    const clerk = await createUser({ email: 'artifact.gone.clerk@example.com', roles: ['Evolve Helper'] })
    expect((await capsOf(clerk)).admin).toBe(true)
  })
})

test("a disabled app's Tables still do not count towards Admin", async ({ admin, createUser }) => {
  await installAppWithReaderRole(admin)
  await admin.post('/api/set_app_enabled', { name: 'feather_dash', enabled: false })
  const reader = await createUser({ email: 'disabled.app.reader@example.com', roles: [ROLE] })
  expect((await capsOf(reader)).admin).toBe(false)
})
