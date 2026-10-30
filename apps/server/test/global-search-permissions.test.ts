import { describe, expect } from 'vitest'
import { resolve } from 'node:path'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { registryLabel, type SearchHit } from '../src/search'
import { test } from './pg-test'
import { sql } from '../src/db'
import { discoverPackages } from '../src/runtime-packages'
import { createUserWithRole, grantRole, makeTable, type TableRef } from './fixtures'

const search = (client: TestClient, query: string) =>
  client.get<{ results: SearchHit[] }>(`/api/search?q=${encodeURIComponent(query)}`)

async function setupSensitiveTitle(
  admin: TestClient,
  createUser: CreateUserFn,
): Promise<{ table: TableRef; basicUser: TestClient; elevatedUser: TestClient }> {
  const table = await makeTable(admin, {
    name: 'Gs Sensitive Customer',
    id_pattern: 'prompt',
    title_column: 'secret_name',
    columns: [
      'city',
      { column_name: 'secret_name', column_type: 'Data', tier: 'restricted' },
    ],
  })
  const basicUser = await createUserWithRole(admin, createUser, {
    role: 'Gs Sensitive Basic Role',
    table: table.name,
    can_read: true,
  })
  await grantRole(admin, {
    role: 'Gs Sensitive Title Role',
    table: table.name,
    tier: 'restricted',
    can_read: true,
  })
  const elevatedUser = await createUser({
    roles: ['Gs Sensitive Basic Role', 'Gs Sensitive Title Role'],
  })
  await admin.post(table.url, {
    row_id: 'visible-customer-id',
    city: 'Chennai',
    secret_name: 'gs-secret-customer-name',
  })
  return { table, basicUser, elevatedUser }
}

describe('global search permissions', () => {
  test('a scope storage failure is not disguised as an empty search result', async ({ admin, createUser }) => {
    const table = await makeTable(admin, { name: 'Gs Broken Scope', columns: ['title'] })
    const reader = await createUserWithRole(admin, createUser, { role: 'Gs Broken Scope Reader', table: table.name, can_read: true })
    await sql`drop table data_scope`
    const response = await reader.fetch('/api/search?q=anything')
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ error: { type: 'InternalError' } })
  })

  test('own-row limits protect both ID and title matches', async ({ admin, createUser }) => {
    const table = await makeTable(admin, {
      name: 'Gs Own Customer',
      id_pattern: 'prompt',
      title_column: 'customer_name',
      columns: ['customer_name'],
    })
    const alice = await createUserWithRole(admin, createUser, {
      role: 'Gs Own Customer Role',
      table: table.name,
      own_rows_only: true,
      can_read: true,
      can_create: true,
      can_write: true,
    })
    const bob = await createUser({ roles: ['Gs Own Customer Role'] })

    expect(await admin.get(table.metaUrl)).toMatchObject({ title_column: 'customer_name' })
    await alice.post(table.url, { row_id: 'gs-asymmetric-scope', customer_name: 'Alice' })
    await bob.post(table.url, { row_id: 'bob-customer', customer_name: 'gs-asymmetric-scope' })

    const { results } = await search(alice, 'gs-asymmetric-scope')
    expect(results.filter((hit) => hit.table === table.name)).toEqual([
      { table: table.name, row_id: 'gs-asymmetric-scope', title: 'Alice' },
    ])
  })

  test('Data Scope protects chosen rows and rows that reference them', async ({
    admin,
    createUser,
  }) => {
    const region = await makeTable(admin, {
      name: 'Gs Search Region',
      id_pattern: 'prompt',
      columns: ['label'],
    })
    const customer = await makeTable(admin, {
      name: 'Gs Scoped Customer',
      id_pattern: 'prompt',
      title_column: 'customer_name',
      columns: [
        'customer_name',
        { column_name: 'region', column_type: 'Reference', reference_table: region.name },
      ],
    })
    const user = await createUserWithRole(admin, createUser, {
      role: 'Gs Scoped Customer Role',
      table: [region.name, customer.name],
      can_read: true,
    })

    await admin.post(region.url, { row_id: 'gs-region-scope-east', label: 'East' })
    await admin.post(region.url, { row_id: 'gs-region-scope-west', label: 'West' })
    await admin.post(customer.url, {
      row_id: 'east-customer',
      customer_name: 'gs-customer-scope East',
      region: 'gs-region-scope-east',
    })
    await admin.post(customer.url, {
      row_id: 'west-customer',
      customer_name: 'gs-customer-scope West',
      region: 'gs-region-scope-west',
    })
    await admin.post('/api/save_row', {
      table: 'Data Scope',
      row: { person: user.user, allow_table: region.name, for_value: 'gs-region-scope-east' },
    })

    const regionResults = (await search(user, 'gs-region-scope')).results.filter(
      (hit) => hit.table === region.name,
    )
    expect(regionResults).toEqual([
      {
        table: region.name,
        row_id: 'gs-region-scope-east',
        title: 'gs-region-scope-east',
      },
    ])

    const customerResults = (await search(user, 'gs-customer-scope')).results.filter(
      (hit) => hit.table === customer.name,
    )
    expect(customerResults).toEqual([
      { table: customer.name, row_id: 'east-customer', title: 'gs-customer-scope East' },
    ])
  })

  test('a sensitive title alone cannot produce a search hit', async ({ admin, createUser }) => {
    const { table, basicUser } = await setupSensitiveTitle(admin, createUser)

    const { results } = await search(basicUser, 'gs-secret-customer-name')
    expect(results.filter((hit) => hit.table === table.name)).toEqual([])
  })

  test('an ID match uses the ID instead of a sensitive title', async ({ admin, createUser }) => {
    const { table, basicUser } = await setupSensitiveTitle(admin, createUser)

    const { results } = await search(basicUser, 'visible-customer-id')
    expect(results.filter((hit) => hit.table === table.name)).toEqual([
      {
        table: table.name,
        row_id: 'visible-customer-id',
        title: 'visible-customer-id',
      },
    ])
  })

  test('deeper field access can search and display the sensitive title', async ({
    admin,
    createUser,
  }) => {
    const { table, elevatedUser } = await setupSensitiveTitle(admin, createUser)

    const { results } = await search(elevatedUser, 'gs-secret-customer-name')
    expect(results.filter((hit) => hit.table === table.name)).toEqual([
      {
        table: table.name,
        row_id: 'visible-customer-id',
        title: 'gs-secret-customer-name',
      },
    ])
  })

  test('a direct share stays openable by link without widening search', async ({
    admin,
    createUser,
  }) => {
    const table = await makeTable(admin, {
      name: 'Gs Shared Customer',
      id_pattern: 'prompt',
      title_column: 'customer_name',
      columns: ['customer_name'],
    })
    const alice = await createUserWithRole(admin, createUser, {
      role: 'Gs Shared Customer Role',
      table: table.name,
      own_rows_only: true,
      can_read: true,
      can_create: true,
      can_write: true,
    })
    const bob = await createUser({ roles: ['Gs Shared Customer Role'] })
    await alice.post(table.url, { row_id: 'alice-shared-customer', customer_name: 'Alice' })
    await bob.post(table.url, {
      row_id: 'gs-direct-share-hidden',
      customer_name: 'Shared Customer',
    })
    await admin.post('/api/save_row', {
      table: 'Share',
      row: {
        share_table: table.name,
        share_name: 'gs-direct-share-hidden',
        person: alice.user,
        read: true,
      },
    })

    expect((await alice.fetch(table.rowUrl('gs-direct-share-hidden'))).status).toBe(200)
    const { results } = await search(alice, 'gs-direct-share-hidden')
    expect(results.filter((hit) => hit.table === table.name)).toEqual([])
  })
})

describe('global search ranking (#431)', () => {
  test('registry rows (Table definitions) rank after ordinary records', async ({ admin }) => {
    const table = await makeTable(admin, {
      name: 'Zz Rank Widget',
      id_pattern: 'prompt',
      columns: ['label'],
    })
    await admin.post(table.url, { row_id: 'Zz Rank Widget Row', label: 'x' })

    const { results } = await search(admin, 'zz rank widget')
    const ordinary = results.findIndex((h) => h.table === table.name)
    const registry = results.findIndex((h) => h.table === 'Table')
    expect(ordinary).toBeGreaterThanOrEqual(0)
    expect(registry).toBeGreaterThanOrEqual(0)
    expect(ordinary).toBeLessThan(registry)
  })
})

describe('global search labels (#431)', () => {
  test('a Table definition row carries the label "Table definition"', async ({ admin }) => {
    const table = await makeTable(admin, { name: 'Zz Label Widget', id_pattern: 'prompt', columns: ['label'] })
    const { results } = await search(admin, table.name)
    expect(results.find((h) => h.table === 'Table' && h.row_id === table.name)).toMatchObject({
      kind_label: 'Table definition',
    })
  })

  test('Object.prototype keys are not registries', () => {
    for (const name of ['constructor', 'toString', 'valueOf', '__proto__']) {
      expect(registryLabel(name)).toBeUndefined()
    }
    expect(registryLabel('Table')).toBe('Table definition')
    expect(registryLabel('Metadata Override')).toBe('Metadata override')
  })
})

describe('a connected table is invisible to search', () => {
  test('a row of a Table whose data lives in an outside database never matches, though ordinary Tables do', async ({ admin }) => {
    const plain = await makeTable(admin, { name: 'Gs Plain Customer', id_pattern: 'prompt', columns: ['city'] })
    const linked = await makeTable(admin, { name: 'Gs Linked Customer', id_pattern: 'prompt', columns: ['city'] })
    await admin.post(plain.url, { row_id: 'zq-needle-plain', city: 'Chennai' })
    await admin.post(linked.url, { row_id: 'zq-needle-linked', city: 'Chennai' })
    await sql`update table_def set data_source = 'outside-db' where name = ${linked.name}`
    const hits = (await search(admin, 'zq-needle')).results
    expect(hits.map((h) => h.row_id)).toEqual(['zq-needle-plain'])
  })
})

describe('search shows a handful of best matches, not everything', () => {
  test('at most three rows per Table, and fifteen in all', async ({ admin }) => {
    const names = ['Gs Cap A', 'Gs Cap B', 'Gs Cap C', 'Gs Cap D', 'Gs Cap E', 'Gs Cap F']
    for (const name of names) {
      const t = await makeTable(admin, { name, id_pattern: 'prompt', columns: ['city'] })
      for (let i = 1; i <= 5; i++) await admin.post(t.url, { row_id: `zq-cap-${name.slice(-1)}-${i}`, city: 'x' })
    }
    const hits = (await search(admin, 'zq-cap')).results
    // Six Tables hold five matches each: three apiece would be eighteen, so the overall cap bites.
    expect(hits).toHaveLength(15)
    const perTable = new Map<string, number>()
    for (const h of hits) perTable.set(h.table, (perTable.get(h.table) ?? 0) + 1)
    expect(Math.max(...perTable.values())).toBe(3)
  })

  test('a single Table with many matches shows only its first three', async ({ admin }) => {
    const t = await makeTable(admin, { name: 'Gs Cap Solo', id_pattern: 'prompt', columns: ['city'] })
    for (let i = 1; i <= 8; i++) await admin.post(t.url, { row_id: `zq-solo-${i}`, city: 'x' })
    expect((await search(admin, 'zq-solo')).results).toHaveLength(3)
  })
})

// #648: one turned-off app used to fail the whole search with 403, so
// Records vanished from Admin's search bar for everyone.
describe('global search while an app is unavailable', () => {
  const ROSTER = resolve('../..', 'test-apps/fixtures/place-roster')
  const tables = async (client: TestClient) =>
    (await search(client, 'gs-648')).results.map((r) => r.table).sort()

  async function rosterAndCustomer(admin: TestClient, createUser: CreateUserFn) {
    expect(await discoverPackages([ROSTER])).toEqual([])
    await admin.post('/api/install_app', { name: 'placeroster' })
    await admin.post('/api/save_row', { table: 'placeroster.position', row: { row_id: 'gs-648-roster', person: 'p', place: 'North' } })
    const t = await makeTable(admin, { name: 'Gs 648 Customer', id_pattern: 'prompt', columns: ['city'] })
    await admin.post(t.url, { row_id: 'gs-648-customer', city: 'x' })
    const reader = await createUserWithRole(admin, createUser, { role: 'Gs 648 Reader', table: t.name, can_read: true })
    await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'placeroster.position', role: 'Gs 648 Reader', can_read: true } })
    expect(await tables(admin)).toEqual(['Gs 648 Customer', 'placeroster.position'])
    expect(await tables(reader)).toEqual(['Gs 648 Customer', 'placeroster.position'])
    return reader
  }

  test("skips a turned-off app's Tables, answers from the rest, and finds them again once it is back on", async ({ admin, createUser }) => {
    const reader = await rosterAndCustomer(admin, createUser)
    await admin.post('/api/set_app_enabled', { name: 'placeroster', enabled: false })
    expect(await tables(admin)).toEqual(['Gs 648 Customer'])
    expect(await tables(reader)).toEqual(['Gs 648 Customer'])

    await admin.post('/api/set_app_enabled', { name: 'placeroster', enabled: true })
    expect(await tables(admin)).toEqual(['Gs 648 Customer', 'placeroster.position'])
  })

  test('skips an app awaiting activation of an upgrade', async ({ admin, createUser }) => {
    await rosterAndCustomer(admin, createUser)
    await sql`update installed_app set activation_pending = true where name = 'placeroster'`
    expect(await tables(admin)).toEqual(['Gs 648 Customer'])
  })

  test("skips an upgraded app's Tables for a client still on its old version", async ({ admin, createUser }) => {
    await rosterAndCustomer(admin, createUser)
    // A migrated app's Tables answer only the client that loaded its current
    // version; this client named none.
    await sql`update installed_app set migration_ledger = '["0001"]'::jsonb where name = 'placeroster'`
    expect(await tables(admin)).toEqual(['Gs 648 Customer'])
  })
})
